/**
 * Copyright © 2024 650 Industries.
 * Copyright © 2024 dai-shi.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * From waku https://github.com/dai-shi/waku/blob/32d52242c1450b5f5965860e671ff73c42da8bd0/packages/waku/src/lib/renderers/rsc-renderer.ts
 */

import type { ReactNode } from 'react';
import {
  renderToReadableStream,
  decodeReply,
  registerServerReference,
} from 'react-server-dom-webpack/server';

import { runWithRenderStore, type EntriesDev, type EntriesPrd } from './server';
import { getServerReference, getDebugDescription } from '../server-actions';

// Make global so we only pull in one instance for state saved in the react-server-dom-webpack package.
globalThis._REACT_registerServerReference = registerServerReference;

const streamToString = async (stream: ReadableStream): Promise<string> => {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const outs: string[] = [];
  let result: ReadableStreamReadResult<unknown>;
  do {
    result = await reader.read();
    if (result.value) {
      if (!(result.value instanceof Uint8Array)) {
        throw new Error('Unexepected buffer type');
      }
      outs.push(decoder.decode(result.value, { stream: true }));
    }
  } while (!result.done);
  outs.push(decoder.decode());
  return outs.join('');
};

export interface RenderContext<T = unknown> {
  rerender: (input: string, searchParams?: URLSearchParams) => void;
  context: T;
}

type ResolvedConfig = any;

export type RenderRscArgs = {
  // TODO:
  config: ResolvedConfig;

  // Done
  input: string;
  searchParams: URLSearchParams;
  method: 'GET' | 'POST';
  context: Record<string, unknown> | undefined;
  body?: ReadableStream | undefined;
  contentType?: string | undefined;
  moduleIdCallback?: (module: {
    id: string;
    chunks: string[];
    name: string;
    async: boolean;
  }) => void;
};

type ResolveClientEntry = (id: string) => { id: string; url: string[] };

type RenderRscOpts =
  | {
      isExporting: true;
      entries: EntriesPrd;
      resolveClientEntry?: ResolveClientEntry;
    }
  | {
      isExporting: false;
      entries: EntriesDev;
      resolveClientEntry: ResolveClientEntry;
    };

export async function renderRsc(args: RenderRscArgs, opts: RenderRscOpts): Promise<ReadableStream> {
  const { searchParams, method, input, body, contentType, context } = args;
  const { isExporting, resolveClientEntry, entries } = opts;

  const {
    default: { renderEntries },
    // @ts-expect-error
    buildConfig,
  } = entries as (EntriesDev & { loadModule: never; buildConfig: never }) | EntriesPrd;

  const bundlerConfig = new Proxy(
    {},
    {
      get(_target, encodedId: string) {
        const [
          // File is the on-disk location of the module, this is injected during the "use client" transformation (babel).
          file,
          // The name of the import (e.g. "default" or "")
          // This will be empty when using `module.exports = ` and `require('...')`.
          name = '',
        ] = encodedId.split('#') as [string, string];

        // HACK: Special handling for server actions being recursively resolved, e.g. ai demo.
        if (encodedId.match(/[0-9a-z]{40}#/i)) {
          return { id: encodedId, chunks: [encodedId], name, async: true };
        }

        const filePath = file.startsWith('file://') ? fileURLToFilePath(file) : file;

        // We'll augment the file path with the incoming RSC request which will forward the metro props required to make a cache hit, e.g. platform=web&...
        // This is similar to how we handle lazy bundling.
        if (resolveClientEntry) {
          const resolved = resolveClientEntry(filePath);
          return { id: resolved.id, chunks: resolved.url, name, async: true };
        }

        if (isExporting) {
          return {
            // TODO: Make relative to server root
            id: filePath,
            chunks: [
              // TODO: Add a lookup later which reads from the SSR manifest to get the correct chunk.
              'chunk:' + filePath,
            ],
            name,
            async: true,
          };
        }
      },
    }
  );

  const renderWithContext = async (
    context: Record<string, unknown> | undefined,
    input: string,
    searchParams: URLSearchParams
  ) => {
    const renderStore = {
      context: context || {},
      rerender: () => {
        throw new Error('Cannot rerender');
      },
    };
    return runWithRenderStore(renderStore, async () => {
      const elements = await renderEntries(input, {
        searchParams,
        buildConfig,
      });
      if (elements === null) {
        const err = new Error('No function component found at: ' + input);
        (err as any).statusCode = 404;
        throw err;
      }
      if (Object.keys(elements).some((key) => key.startsWith('_'))) {
        throw new Error('"_" prefix is reserved');
      }
      return renderToReadableStream(elements, bundlerConfig);
    });
  };

  const renderWithContextWithAction = async (
    context: Record<string, unknown> | undefined,
    actionFn: (...args: unknown[]) => unknown,
    actionArgs: unknown[]
  ) => {
    let elementsPromise: Promise<Record<string, ReactNode>> = Promise.resolve({});
    let rendered = false;
    const renderStore = {
      context: context || {},
      rerender: async (input: string, searchParams = new URLSearchParams()) => {
        if (rendered) {
          throw new Error('already rendered');
        }
        elementsPromise = Promise.all([
          elementsPromise,
          renderEntries(input, { searchParams, buildConfig }),
        ]).then(([oldElements, newElements]) => ({
          ...oldElements,
          // FIXME we should actually check if newElements is null and send an error
          ...newElements,
        }));
      },
    };
    return runWithRenderStore(renderStore, async () => {
      const actionValue = await actionFn(...actionArgs);
      const elements = await elementsPromise;
      rendered = true;
      if (Object.keys(elements).some((key) => key.startsWith('_'))) {
        throw new Error('"_" prefix is reserved');
      }
      return renderToReadableStream({ ...elements, _value: actionValue }, bundlerConfig);
    });
  };

  if (method === 'POST') {
    // TODO(Bacon): Fix Server action ID generation
    const rsfId = decodeURIComponent(input);
    let args: unknown[] = [];
    let bodyStr = '';
    if (body) {
      bodyStr = await streamToString(body);
    }
    if (typeof contentType === 'string' && contentType.startsWith('multipart/form-data')) {
      // XXX This doesn't support streaming unlike busboy
      const formData = parseFormData(bodyStr, contentType);
      args = await decodeReply(formData, bundlerConfig);
    } else if (bodyStr) {
      args = await decodeReply(bodyStr, bundlerConfig);
    }
    const [, name] = rsfId.split('#') as [string, string];
    // xxxx#greet
    console.log('[SSR]: Get server action:', rsfId, getServerReference(rsfId));
    if (!getServerReference(rsfId)) {
      throw new Error(`Server action not found: "${rsfId}". ${getDebugDescription()}`);
    }
    const mod: any = getServerReference(rsfId);

    const fn = name ? mod[name] || mod : mod;
    return renderWithContextWithAction(context, fn, args);
  }

  // method === 'GET'
  return renderWithContext(context, input, searchParams);
}

// TODO is this correct? better to use a library?
const parseFormData = (body: string, contentType: string) => {
  const boundary = contentType.split('boundary=')[1];
  const parts = body.split(`--${boundary}`);
  const formData = new FormData();
  for (const part of parts) {
    if (part.trim() === '' || part === '--') continue;
    const [rawHeaders, content] = part.split('\r\n\r\n', 2);
    const headers = rawHeaders!.split('\r\n').reduce(
      (acc, currentHeader) => {
        const [key, value] = currentHeader.split(': ');
        acc[key!.toLowerCase()] = value!;
        return acc;
      },
      {} as Record<string, string>
    );
    const contentDisposition = headers['content-disposition'];
    const nameMatch = /name="([^"]+)"/.exec(contentDisposition!);
    const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition!);
    if (nameMatch) {
      const name = nameMatch[1];
      if (filenameMatch) {
        const filename = filenameMatch[1];
        const type = headers['content-type'] || 'application/octet-stream';
        const blob = new Blob([content!], { type });
        formData.append(name!, blob, filename);
      } else {
        formData.append(name!, content!.trim());
      }
    }
  }
  return formData;
};

// TODO: Implement this in production exports.
export async function getBuildConfig(opts: {
  config: ResolvedConfig;
  entries: EntriesPrd;
  resolveClientEntry: ResolveClientEntry;
}) {
  const { config, entries } = opts;

  const {
    default: { getBuildConfig },
  } = entries;
  if (!getBuildConfig) {
    console.warn(
      "getBuildConfig is undefined. It's recommended for optimization and sometimes required."
    );
    return [];
  }

  const unstable_collectClientModules = async (input: string): Promise<string[]> => {
    const idSet = new Set<string>();
    const readable = await renderRsc(
      {
        config,
        input,
        searchParams: new URLSearchParams(),
        method: 'GET',
        context: undefined,
        moduleIdCallback: ({ id }) => idSet.add(id),
      },
      {
        isExporting: true,
        entries,
      }
    );
    await new Promise<void>((resolve, reject) => {
      const writable = new WritableStream({
        close() {
          resolve();
        },
        abort(reason) {
          reject(reason);
        },
      });
      readable.pipeTo(writable);
    });
    return Array.from(idSet);
  };

  const output = await getBuildConfig(unstable_collectClientModules);
  return output;
}

export type GetSsrConfigArgs = {
  config: ResolvedConfig;
  pathname: string;
  searchParams: URLSearchParams;
};

type GetSsrConfigOpts =
  | { isDev: false; entries: EntriesPrd; resolveClientEntry: ResolveClientEntry }
  | {
      isDev: true;
      entries: EntriesDev;
      resolveClientEntry: ResolveClientEntry;
    };

export async function getSsrConfig(args: GetSsrConfigArgs, opts: GetSsrConfigOpts) {
  const { pathname, searchParams } = args;
  const { entries } = opts;

  const resolveClientEntry = opts.resolveClientEntry;

  const {
    default: { getSsrConfig },
  } = entries as (EntriesDev & { loadModule: undefined }) | EntriesPrd;

  const ssrConfig = await getSsrConfig?.(pathname, { searchParams });
  if (!ssrConfig) {
    return null;
  }
  const bundlerConfig = new Proxy(
    {},
    {
      get(_target, encodedId: string) {
        const [file, name = ''] = encodedId.split('#') as [string, string];
        console.warn('TODO: SSR Config');
        const id = resolveClientEntry(file);
        return { id, chunks: [id], name, async: true };
      },
    }
  );
  return {
    ...ssrConfig,
    body: renderToReadableStream(ssrConfig.body, bundlerConfig),
  };
}

const fileURLToFilePath = (fileURL: string) => {
  if (!fileURL.startsWith('file://')) {
    throw new Error('Not a file URL');
  }
  return decodeURI(fileURL.slice('file://'.length));
};
