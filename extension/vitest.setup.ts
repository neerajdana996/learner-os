import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Testing Library only auto-registers this when `globals: true`, and this
// project imports `describe`/`it` explicitly. Without it, one test's DOM is
// still mounted during the next — which reads as a component rendering two
// mutually exclusive branches at once.
afterEach(cleanup);
