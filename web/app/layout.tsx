import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visual RAG Agent",
  description: "Agentic multimodal Q&A over illustrated PDFs (ColPali + Qdrant + GPT-4o)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
