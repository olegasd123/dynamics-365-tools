const path = require("path");
const Module = require("module");

const shimPath = __dirname;
const current = process.env.NODE_PATH
  ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean)
  : [];

if (!current.includes(shimPath)) {
  current.unshift(shimPath);
}

process.env.NODE_PATH = current.join(path.delimiter);
Module._initPaths();
