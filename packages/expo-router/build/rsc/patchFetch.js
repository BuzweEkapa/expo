"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReactServerError = exports.MetroServerError = exports.NetworkError = void 0;
/**
 * Copyright © 2024 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class NetworkError extends Error {
    url;
    code = 'NETWORK_ERROR';
    constructor(message, url) {
        super(message);
        this.url = url;
        this.name = 'NetworkError';
    }
}
exports.NetworkError = NetworkError;
class MetroServerError extends Error {
    url;
    code = 'METRO_SERVER_ERROR';
    constructor(errorObject, url) {
        super(errorObject.message);
        this.url = url;
        this.name = 'MetroServerError';
        for (const key in errorObject) {
            this[key] = errorObject[key];
        }
    }
}
exports.MetroServerError = MetroServerError;
class ReactServerError extends Error {
    url;
    statusCode;
    code = 'REACT_SERVER_ERROR';
    constructor(message, url, statusCode) {
        super(message);
        this.url = url;
        this.statusCode = statusCode;
        this.name = 'ReactServerError';
    }
}
exports.ReactServerError = ReactServerError;
//# sourceMappingURL=patchFetch.js.map