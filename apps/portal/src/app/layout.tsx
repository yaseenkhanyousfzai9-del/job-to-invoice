import type { ReactNode } from "react";

export const metadata = {
  title: "Job to Invoice — Customer portal",
  description: "Customer review portal foundation. Approval is not available yet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#F7F8FA",
          color: "#17212B",
        }}
      >
        {children}
      </body>
    </html>
  );
}
