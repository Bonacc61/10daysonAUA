// Extends `expect` with the DOM matchers (toBeInTheDocument, toHaveTextContent…).
//
// Loaded for EVERY test file, including the node-environment ones. That is safe:
// this import only registers matchers, it does not touch `document`. The jsdom
// environment itself is opted into per file with a `@vitest-environment jsdom`
// docblock, so the ~600 pure-logic tests keep running in node and stay fast.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount between tests. Without this, queries like getByText see leftovers from
// the previous render and a passing test can be reading the wrong card.
afterEach(() => { cleanup(); });
