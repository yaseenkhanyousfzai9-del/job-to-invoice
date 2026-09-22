import type { ReactNode } from "react";

export const metadata = {
  title: "Job to Invoice — Admin",
  description: "Restricted support console foundation. Staff tools are not implemented yet.",
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
