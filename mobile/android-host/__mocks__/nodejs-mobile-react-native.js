'use strict';

module.exports = {
  channel: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    send: jest.fn(),
  },
  start: jest.fn(),
};
