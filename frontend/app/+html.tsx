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
        {/* Installable as an app (Add to Home Screen): its own icon, full
            screen without the address bar - and on an iPhone, only a site
            added to the home screen may send push notifications. */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Фактура+" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: pageStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
