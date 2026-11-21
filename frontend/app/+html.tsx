import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { COLORS } from '../src/theme/colors';

// The web page around the app (the static web build only - this runs when
// the pages are built, never in the browser). The page itself has the app's
// dark background: before the app has drawn, and anywhere a screen could
// leave the page uncovered, the browser shows dark rather than a white band;
// the phone browser's own bar takes the same colour.
const pageStyle = `html, body { background-color: ${COLORS.background}; }`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="bg">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content={COLORS.background} />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: pageStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
