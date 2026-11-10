import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Host_Grotesk } from "next/font/google";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const hostGrotesk = Host_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GatorAdvisor",
  description: "Plan your UF degree with confidence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hostGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
          <ClerkProvider appearance={{ variables: { colorBackground: "var(--card)" } }}>
            {children}
          </ClerkProvider>
        </body>
    </html>
  );
}
