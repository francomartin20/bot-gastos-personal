export const metadata = {
  title: "Bot de Gastos",
  description: "Bot personal de control de gastos vía Telegram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
