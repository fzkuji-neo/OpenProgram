import localFont from "next/font/local";

// Inter's Latin face through next/font: the build adds a <link rel="preload">
// for it, so the file is requested with the HTML instead of after the CSS,
// and `block` keeps text from being painted in the system font first and
// swapped (a cold restart could show that switch). Other scripts still use
// the @fontsource-variable/inter faces imported in globals.css.
export const interLatin = localFont({
  src: "../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "block",
  variable: "--font-inter-latin",
  adjustFontFallback: false,
});
