'use strict';

const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef((props, ref) => (
  React.createElement(View, { ...props, ref, testID: 'songless-webview' })
));

module.exports = { WebView };
