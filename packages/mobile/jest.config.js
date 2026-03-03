/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.ts'],
  transformIgnorePatterns: [
    '<rootDir>/../../node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@protoimsg/.*)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@protoimsg/shared$': '<rootDir>/../shared/src',
    '^@protoimsg/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@protoimsg/lexicon$': '<rootDir>/../lexicon/src',
    '^@protoimsg/lexicon/(.*)$': '<rootDir>/../lexicon/src/$1',
  },
};
