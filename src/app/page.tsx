import Script from 'next/script';
import App from './app-client';

export default function Page() {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <App />
    </>
  );
}
