import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Host_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const hostGrotesk = Host_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

/* Course codes only ("COP 3502"), via the `font-mono` utility. */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "GatorAdvisor",
  description: "Plan your UF degree with confidence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hostGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
