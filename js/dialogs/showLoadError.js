'use strict';

const electron = require('electron');

/**
 * Show dialog pinned to given window when loading error occurs
 * @param  {BrowserWindow} win       Window to host dialog
 * @param  {String} url              Url that failed
 * @param  {String} errorDesc        Description of error
 * @param  {Number} errorCode        Error code
 * @param  {callback} retryCallback  Callback when user clicks reload
 */
function showLoadFailure(win, url, errorDesc, errorCode, retryCallback) {
    let msg;
    if (url) {
        msg = 'Error loading URL:\n' + url;
    } else {
        msg = 'Error loading window'
    }
    if (errorDesc) {
        msg += '\n\n' + errorDesc;
    }
    if (errorCode) {
        msg += '\n\nError Code: ' + errorCode;
    }

    electron.dialog.showMessageBox(win, {
        type: 'error',
        buttons: [ 'Reload', 'Ignore' ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Loading Error',
        message: msg
    }, response);

    // async handle of user input
    function response(buttonId) {
        // ignore button hit, do nothing
        if (buttonId === 1) {
            return;
        }

        if (typeof retryCallback === 'function') {
            retryCallback();
        }
    }
}

/**
 * Show message indicating network connectivity has been lost.
 * @param  {BrowserWindow} win       Window to host dialog
 * @param  {String} url              Url that failed
 * @param  {callback} retryCallback  Callback when user clicks reload
 */
function showNetworkConnectivityError(win, url, retryCallback) {
    var errorDesc = 'Network connectivity has been lost, check your internet connection.';
    showLoadFailure(win, url, errorDesc, 0, retryCallback);
}

module.exports = { showLoadFailure, showNetworkConnectivityError };
