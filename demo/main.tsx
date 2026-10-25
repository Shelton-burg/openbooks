import React from 'react';
import {createRoot} from 'react-dom/client';
import Books from '../app/books';
import '../app/globals.css';
// This static demo has no API, authentication, storage or real business records.
// Block all network writes and API reads even if a future sample control calls fetch.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (url.pathname.startsWith('/api/'))
    return Promise.resolve(
      Response.json(
        {
          error: 'This demo uses fictional records. Install a private copy to save your own books.',
        },
        {status: 403},
      ),
    );
  return originalFetch(input, init);
};
createRoot(document.getElementById('root')!).render(
  <>
    <div className="community-demo-banner">
      <strong>OpenBooks · Beta demo</strong>
      <span>Fictional data · Read-only tour</span>
      <a href="./tradedesk-books-community.zip">Download source & installation guide</a>
    </div>
    <Books displayName="Demo visitor" demoOnly />
  </>,
);
