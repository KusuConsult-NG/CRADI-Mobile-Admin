'use client';

import { useEffect, useId, useRef } from 'react';

interface ModalProps {
    title: React.ReactNode;
    titleClassName?: string;
    /** Called on Escape. Omit (or pass a no-op) while the dialog must stay open. */
    onClose: () => void;
    /** Ignore Escape (e.g. while saving). */
    closeDisabled?: boolean;
    /** Classes for the dialog panel (width, padding, scrolling). */
    className?: string;
    children: React.ReactNode;
}

const FIELD_SELECTOR = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE_SELECTOR = `${FIELD_SELECTOR}, button:not([disabled]), a[href]`;

/**
 * Accessible modal dialog: role="dialog" + aria-modal, labelled by its title,
 * closes on Escape, moves focus to the first form field (or first button) when
 * opened and restores it to the previously focused element when closed.
 */
export default function Modal({
    title,
    titleClassName = 'text-xl font-bold mb-4 text-gray-900',
    onClose,
    closeDisabled = false,
    className = 'max-w-md w-full p-6',
    children,
}: ModalProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const closeDisabledRef = useRef(closeDisabled);

    useEffect(() => {
        onCloseRef.current = onClose;
        closeDisabledRef.current = closeDisabled;
    }, [onClose, closeDisabled]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const panel = panelRef.current;
        const first =
            panel?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        (first ?? panel)?.focus();

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !closeDisabledRef.current) {
                e.stopPropagation();
                onCloseRef.current();
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus();
        };
    }, []);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`bg-white text-gray-900 rounded-xl shadow-2xl outline-none ${className}`}
            >
                <h3 id={titleId} className={titleClassName}>
                    {title}
                </h3>
                {children}
            </div>
        </div>
    );
}
