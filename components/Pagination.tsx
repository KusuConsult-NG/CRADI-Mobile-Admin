'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
    page: number;
    pageSize: number;
    total: number | null;
    itemCount: number;
    noun: string;
    disabled?: boolean;
    onPageChange: (page: number) => void;
}

/** Footer with "Showing a–b of n" and Previous / Next buttons (0-based pages). */
export default function Pagination({ page, pageSize, total, itemCount, noun, disabled, onPageChange }: PaginationProps) {
    const from = itemCount === 0 ? 0 : page * pageSize + 1;
    const to = page * pageSize + itemCount;
    const pageCount = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
    const hasPrev = page > 0;
    const hasNext = pageCount === null ? itemCount === pageSize : page + 1 < pageCount;

    return (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-gray-600">
                {itemCount === 0
                    ? `No ${noun}`
                    : `Showing ${from.toLocaleString()}–${to.toLocaleString()}${total !== null ? ` of ${total.toLocaleString()}` : ''} ${noun}`}
            </p>
            <div className="flex items-center gap-2">
                {pageCount !== null && (
                    <span className="text-sm text-gray-500 mr-2">
                        Page {page + 1} of {pageCount}
                    </span>
                )}
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={disabled || !hasPrev}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                </button>
                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={disabled || !hasNext}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                    Next
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
