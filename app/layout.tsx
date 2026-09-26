import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "react-hot-toast";
import { connection } from "next/server";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EWER Admin Panel",
  description: "Early Warning and Emergency Response - Admin Panel",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Render per request: proxy.ts issues a fresh CSP nonce for every request,
  // and a prerendered page would carry scripts without it.
  await connection();
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
          <Toaster position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
