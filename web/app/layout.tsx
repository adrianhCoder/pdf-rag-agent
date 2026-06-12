import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visual RAG Agent",
  description: "Agentic multimodal Q&A over illustrated PDFs — text-embedding retrieval + Gemini vision answering, with cited source pages",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
