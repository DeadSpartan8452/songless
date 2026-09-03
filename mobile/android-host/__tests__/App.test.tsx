/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {it} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer';

it('renders correctly', () => {
  let app: renderer.ReactTestRenderer;
  renderer.act(() => {
    app = renderer.create(<App />);
  });
  renderer.act(() => {
    app.unmount();
  });
});
