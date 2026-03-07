import "./globals.css";

export const metadata = {
  title: "GE Monitor",
  description: "RS3 + OSRS Grand Exchange price monitor",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui" }}>{children}</body>
    </html>
  );
}
