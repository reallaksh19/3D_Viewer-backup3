/**
 * BrowserConverterExecutor.js
 *
 * Thin browser-side adapter around the converter worker contract used by
 * model-converters. It exposes a simple function that accepts File/Blob input
 * and returns a normalized output payload with outputText.
 *
 * Boundary:
 * - No topology work.
 * - No PCF generation.
 * - No master resolution.
 */

import {
  buildConverterWorkerRequest,
  validateConverterWorkerResponse,
} from './worker-contract.js';

function toText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function inferMime(fileName) {
  const name = toText(fileName).toLowerCase();
  if (name.endsWith('.json')) return 'application/json;charset=utf-8';
  if (name.endsWith('.xml')) return 'application/xml;charset=utf-8';
  if (name.endsWith('.pcf')) return 'text/plain;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

function firstTextOutput(outputs) {
  const list = Array.isArray(outputs) ? outputs : [];
  return list.find(entry => entry && typeof entry.text === 'string') || null;
}

export function createBrowserConverterExecutor() {
  const worker = new Worker(new URL('./py-worker.js?v=20260516-uxml-bridge', import.meta.url), {
    type: 'module',
  });
  const pending = new Map();
  let nextJobId = 1;

  function onMessage(event) {
    const payload = event.data || {};
    const request = pending.get(payload.jobId);
    if (!request) return;

    pending.delete(payload.jobId);
    const validation = validateConverterWorkerResponse(payload);
    if (!validation.ok) {
      request.reject(new Error(validation.error));
      return;
    }

    if (!payload.ok) {
      request.reject(new Error(toText(payload.error || 'Converter worker failed.')));
      return;
    }

    const outputs = Array.isArray(payload.outputs) ? payload.outputs : [];
    const primaryOutput = firstTextOutput(outputs);
    request.resolve({
      ok: true,
      outputs,
      logs: payload.logs || {},
      outputText: primaryOutput ? String(primaryOutput.text) : '',
      outputName: primaryOutput ? String(primaryOutput.name || '') : '',
      outputMime: primaryOutput ? String(primaryOutput.mime || inferMime(primaryOutput.name || 'output.txt')) : 'text/plain;charset=utf-8',
    });
  }

  function onError(event) {
    const error = new Error(toText(event?.message || 'Converter worker crashed.'));
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);

  async function execute(request) {
    const converterId = toText(request?.converterId || '').trim();
    if (!converterId) {
      throw new Error('converterId is required for browser converter execution.');
    }

    const sourceFile = request?.sourceFile || request?.sourceBlob || null;
    const sourceArrayBuffer = request?.sourceArrayBuffer instanceof ArrayBuffer
      ? request.sourceArrayBuffer
      : sourceFile && typeof sourceFile.arrayBuffer === 'function'
        ? await sourceFile.arrayBuffer()
        : null;

    if (!(sourceArrayBuffer instanceof ArrayBuffer)) {
      throw new Error(`Primary source bytes are required for converter ${converterId}.`);
    }

    const sourceName = toText(
      request?.fileName ||
      sourceFile?.name ||
      request?.sourceName ||
      'input.dat'
    ).trim() || 'input.dat';

    const inputFiles = Array.isArray(request?.inputFiles) && request.inputFiles.length
      ? request.inputFiles
      : [
          {
            role: 'primary',
            name: sourceName,
            bytes: sourceArrayBuffer,
          },
        ];

    const transfer = [];
    for (const fileSpec of inputFiles) {
      if (fileSpec?.bytes instanceof ArrayBuffer) transfer.push(fileSpec.bytes);
    }

    const jobId = nextJobId;
    nextJobId += 1;

    return new Promise((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      worker.postMessage(
        buildConverterWorkerRequest(
          jobId,
          converterId,
          inputFiles,
          request?.options || {}
        ),
        transfer
      );
    });
  }

  function dispose() {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.terminate();
    pending.clear();
  }

  return { execute, dispose };
}
