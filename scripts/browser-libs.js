import axios from 'axios';
import lodash from 'lodash';
import * as anime from 'animejs';
import Chart from 'chart.js/auto';
import * as luxon from 'luxon';
import Hammer from 'hammerjs';
import { createRxDatabase } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { openNotebook } from './lib/offline-notebook.js';

// The public vanilla interface. The bundle has no runtime CDN dependencies.
window.App = window.App || {};
window.App.libs = Object.freeze({
  axios,
  lodash,
  anime,
  Chart,
  luxon,
  Hammer,
  rxdb: Object.freeze({ createRxDatabase, getRxStorageDexie, wrappedValidateAjvStorage }),
  openNotebook
});

// Preserve the existing Markdown renderer's globals and script interface.
window.marked = marked;
window.hljs = hljs;
window.DOMPurify = DOMPurify;
