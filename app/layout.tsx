import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "유나와 함께 찬송을 | 찬송가 조옮김",
  description:
    "우리의 목소리에 맞는 조로. 찬송가 악보를 고르고 PDF와 PNG로 내려받으세요.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
