'use strict'
//
// code here adapted from https://www.npmjs.com/package/electron-notify
// made following changes:
// - place notification in corner of screen
// - notification color
// - notification flash/blink
// - custom design for symphony notification style
// - if screen added/removed or size change then close all notifications
//
const path = require('path');
const fs = require('fs');
const async = require('async');
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipc = electron.ipcMain;

// maximum number of notifications that can be queued, after limit is
// reached then error func callback will be invoked.
const MAX_QUEUE_SIZE = 30;

let AnimationQueue = require('./AnimationQueue.js');

// Array of windows with currently showing notifications
let activeNotifications = [];

// Recycle windows
let inactiveWindows = [];

// If we cannot show all notifications, queue them
let notificationQueue = [];

// To prevent executing mutliple animations at once
let animationQueue = new AnimationQueue();

// To prevent double-close notification window
let closedNotifications = {};

// Give each notification a unique id
let latestID = 0;

let nextInsertPos = {};

let config = {
    // corner to put notifications
    // upper-right, upper-left, lower-right, lower-left
    startCorner: 'upper-right',
    width: 300,
    height: 80,
    padding: 4,
    borderRadius: 5,
    displayTime: 5000,
    animationSteps: 5,
    animationStepMs: 5,
    animateInParallel: true,
    pathToModule: '',
    logging: true,
    defaultStyleContainer: {
        display: 'flex',
        justifyContent: 'center',
        flexDirection: 'column',
        backgroundColor: '#f0f0f0',
        overflow: 'hidden',
        padding: 4,
        border: '1px solid #CCC',
        position: 'relative',
        lineHeight: '15px'
    },
    defaultStyleHeader: {
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'row'
    },
    defaultStyleImage: {
        flex: '0 0 auto',
        overflow: 'hidden',
        height: 30,
        width: 30,
        marginLeft: 0,
        marginRight: 8
    },
    defaultStyleClose: {
        position: 'absolute',
        top: 12,
        right: 12,
        fontSize: 12,
        color: '#CCC'
    },
    defaultStyleTitle: {
        fontFamily: 'Arial',
        fontSize: 13,
        marginRight: 10,
        alignSelf: 'center',
        overflow: 'hidden',
        display: '-webkit-box',
        webkitLineClamp: 2,
        webkitBoxOrient: 'vertical',
    },
    defaultStyleText: {
        flex: '0 0 auto',
        fontFamily: 'Calibri',
        fontSize: 12,
        margin: 0,
        marginTop: 3,
        overflow: 'hidden',
        display: '-webkit-box',
        webkitLineClamp: 2,
        webkitBoxOrient: 'vertical',
        cursor: 'default'
    },
    defaultWindow: {
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        frame: false,
        transparent: true,
        acceptFirstMouse: true,
        webPreferences: {
            preload: path.join(__dirname, 'electron-notify-preload.js'),
            sandbox: true,
            nodeIntegration: false
        }
    }
}

// function setConfig(customConfig) {
//     Object.assign(customConfig, config);
//
//     calcDimensions();
// }

app.on('ready', function() {
    setupConfig();

    // if display added/removed/changed then re-run setup and remove all existing
    // notifications.  ToDo: should reposition notifications rather than closing.
    electron.screen.on('display-added', setupConfig);
    electron.screen.on('display-removed', setupConfig);
    electron.screen.on('display-metrics-changed', setupConfig);
});


function getTemplatePath() {
    let templatePath = path.join(__dirname, 'electron-notify.html');
    try {
        fs.statSync(templatePath).isFile();
    } catch (err) {
        log('electron-notify: Could not find template ("' + templatePath + '").');
    }
    config.templatePath = 'file://' + templatePath;
    return config.templatePath;
}

function calcDimensions() {
    // Calc totalHeight & totalWidth
    config.totalHeight = config.height + config.padding
    config.totalWidth = config.width + config.padding

    let firstPosX, firstPosY;
    switch (config.startCorner) {
        case 'upper-right':
            firstPosX = config.corner.x - config.totalWidth;
            firstPosY = config.corner.y;
            break;
        case 'lower-right':
            firstPosX = config.corner.x - config.totalWidth;
            firstPosY = config.corner.y - config.totalHeight;
            break;
        case 'lower-left':
            firstPosX = config.corner.x;
            firstPosY = config.corner.y - config.totalHeight;
            break;
        case 'upper-left':
        default:
            firstPosX = config.corner.x;
            firstPosY = config.corner.y;
            break;
    }

    // Calc pos of first notification:
    config.firstPos = {
        x: firstPosX,
        y: firstPosY
    }

    // Set nextInsertPos
    nextInsertPos.x = config.firstPos.x
    nextInsertPos.y = config.firstPos.y
}

function setupConfig() {
    closeAll();

    // Use primary display only
    let display = electron.screen.getPrimaryDisplay();

    config.corner = {};
    config.corner.x = display.bounds.x + display.workArea.x;
    config.corner.y = display.bounds.y + display.workArea.y;

    // update corner x/y based on corner of screen where notf should appear
    const workAreaWidth = display.workAreaSize.width;
    const workAreaHeight = display.workAreaSize.height;
    switch (config.startCorner) {
        case 'upper-right':
            config.corner.x += workAreaWidth;
            break;
        case 'lower-right':
            config.corner.x += workAreaWidth;
            config.corner.y += workAreaHeight;
            break;
        case 'lower-left':
            config.corner.y += workAreaHeight;
            break;
        case 'upper-left':
        default:
            // no change needed
            break;
    }

    calcDimensions();

    // Maximum amount of Notifications we can show:
    config.maxVisibleNotifications = Math.floor(display.workAreaSize.height / config.totalHeight);
    config.maxVisibleNotifications = config.maxVisibleNotifications > 5 ? 5 : config.maxVisibleNotifications;
}


function notify(notification) {
    if (notificationQueue.length >= MAX_QUEUE_SIZE) {
        var id = latestID;
        incrementId();
        if (typeof notification.onErrorFunc === 'function') {
            setTimeout(function() {
                notification.onErrorFunc({
                    id: id,
                    error: 'max notification queue size reached: ' + MAX_QUEUE_SIZE
                });
            }, 0);
        }
        return id;
    }

    // Is it an object and only one argument?
    if (arguments.length === 1 && typeof notification === 'object') {
        let notf = Object.assign({}, notification);
        // Use object instead of supplied parameters
        notf.id = latestID;
        incrementId();
        animationQueue.push({
            func: showNotification,
            args: [ notf ]
        })
        return notf.id
    }
    log('electron-notify: ERROR notify() only accepts a single object with notification parameters.')
    return null;
}

function incrementId() {
    latestID++;
}

function showNotification(notificationObj) {
    return new Promise(function(resolve) {
        // Can we show it?
        if (activeNotifications.length < config.maxVisibleNotifications) {
            // Get inactiveWindow or create new:
            getWindow().then(function(notificationWindow) {
                // Move window to position
                calcInsertPos()
                setWindowPosition(notificationWindow, nextInsertPos.x, nextInsertPos.y)

                // Add to activeNotifications
                activeNotifications.push(notificationWindow)

                // Display time per notification basis.
                let displayTime = notificationObj.displayTime ? notificationObj.displayTime : config.displayTime

                // Set timeout to hide notification
                let timeoutId
                let closeFunc = buildCloseNotification(notificationWindow, notificationObj, function() {
                    return timeoutId
                })
                let closeNotificationSafely = buildCloseNotificationSafely(closeFunc)
                timeoutId = setTimeout(function() {
                    closeNotificationSafely('timeout')
                }, displayTime)

                // Trigger onShowFunc if existent
                if (notificationObj.onShowFunc) {
                    notificationObj.onShowFunc({
                        event: 'show',
                        id: notificationObj.id,
                        closeNotification: closeNotificationSafely
                    })
                }

                var updatedNotificationWindow = notificationWindow;

                // Save onClickFunc in notification window
                if (notificationObj.onClickFunc) {
                    updatedNotificationWindow.electronNotifyOnClickFunc = notificationObj.onClickFunc
                } else {
                    delete updatedNotificationWindow.electronNotifyOnClickFunc
                }

                if (notificationObj.onCloseFunc) {
                    updatedNotificationWindow.electronNotifyOnCloseFunc = notificationObj.onCloseFunc
                } else {
                    delete updatedNotificationWindow.electronNotifyOnCloseFunc
                }

                const windowId = notificationWindow.id;
                // Set contents, ...
                updatedNotificationWindow.webContents.send('electron-notify-set-contents',
                    Object.assign({ windowId: windowId}, notificationObj));
                // Show window
                updatedNotificationWindow.showInactive();
                resolve(updatedNotificationWindow)
            })
        } else {
            // Add to notificationQueue
            notificationQueue.push(notificationObj)
            resolve()
        }
    })
}

// Close notification function
function buildCloseNotification(notificationWindow, notificationObj, getTimeoutId) {
    return function(event) {
        if (closedNotifications[notificationObj.id]) {
            delete closedNotifications[notificationObj.id];
            return new Promise(function(exitEarly) { exitEarly() });
        }
        closedNotifications[notificationObj.id] = true;


        if (notificationWindow.electronNotifyOnCloseFunc) {
            notificationWindow.electronNotifyOnCloseFunc({
                event: event,
                id: notificationObj.id
            });
            // ToDo: fix this: shouldn't delete method on arg
            /* eslint-disable */
            delete notificationWindow.electronNotifyOnCloseFunc;
            /* eslint-enable */
        }

        // reset content
        notificationWindow.webContents.send('electron-notify-reset')
        if (getTimeoutId && typeof getTimeoutId === 'function') {
            let timeoutId = getTimeoutId();
            clearTimeout(timeoutId);
        }

        // Recycle window
        let pos = activeNotifications.indexOf(notificationWindow);
        activeNotifications.splice(pos, 1);
        inactiveWindows.push(notificationWindow);

        // Hide notification
        notificationWindow.hide();

        checkForQueuedNotifications();

        // Move notifications down
        return moveOneDown(pos);
    }
}

// Always add to animationQueue to prevent erros (e.g. notification
// got closed while it was moving will produce an error)
function buildCloseNotificationSafely(closeFunc) {
    return function(reason) {
        animationQueue.push({
            func: closeFunc,
            args: [ reason || 'closedByAPI' ]
        });
    }
}

ipc.on('electron-notify-close', function (event, winId, notificationObj) {
    let closeFunc = buildCloseNotification(BrowserWindow.fromId(winId), notificationObj);
    buildCloseNotificationSafely(closeFunc)('close');
});

ipc.on('electron-notify-click', function (event, winId, notificationObj) {
    let notificationWindow = BrowserWindow.fromId(winId);
    if (notificationWindow && notificationWindow.electronNotifyOnClickFunc) {
        let closeFunc = buildCloseNotification(notificationWindow, notificationObj);
        notificationWindow.electronNotifyOnClickFunc({
            event: 'click',
            id: notificationObj.id,
            closeNotification: buildCloseNotificationSafely(closeFunc)
        });
        delete notificationWindow.electronNotifyOnClickFunc;
    }
});

/*
* Checks for queued notifications and add them
* to AnimationQueue if possible
*/
function checkForQueuedNotifications() {
    if (notificationQueue.length > 0 &&
    activeNotifications.length < config.maxVisibleNotifications) {
    // Add new notification to animationQueue
        animationQueue.push({
            func: showNotification,
            args: [ notificationQueue.shift() ]
        })
    }
}

/*
* Moves the notifications one position down,
* starting with notification at startPos
*
* @param  {int} startPos
*/
function moveOneDown(startPos) {
    return new Promise(function(resolve) {
        if (startPos >= activeNotifications || startPos === -1) {
            resolve()
            return
        }
    // Build array with index of affected notifications
        let notificationPosArray = []
        for (let i = startPos; i < activeNotifications.length; i++) {
            notificationPosArray.push(i)
        }
    // Start to animate all notifications at once or in parallel
        let asyncFunc = async.map // Best performance
        if (config.animateInParallel === false) {
            asyncFunc = async.mapSeries // Sluggish
        }
        asyncFunc(notificationPosArray, moveNotificationAnimation, function() {
            resolve()
        })
    })
}

function moveNotificationAnimation(i, done) {
    // Get notification to move
    let notificationWindow = activeNotifications[i];

    // Calc new y position
    let newY;
    switch(config.startCorner) {
        case 'upper-right':
        case 'upper-left':
            newY = config.corner.y + (config.totalHeight * i);
            break;
        default:
        case 'lower-right':
        case 'lower-left':
            newY = config.corner.y - (config.totalHeight * (i + 1));
            break;
    }

    // Get startPos, calc step size and start animationInterval
    let startY = notificationWindow.getPosition()[1]
    let step = (newY - startY) / config.animationSteps
    let curStep = 1
    let animationInterval = setInterval(function() {
        // Abort condition
        if (curStep === config.animationSteps) {
            setWindowPosition(notificationWindow, config.firstPos.x, newY);
            clearInterval(animationInterval)
            done(null, 'done');
            return;
        }
        // Move one step down
        setWindowPosition(notificationWindow, config.firstPos.x, startY + curStep * step)
        curStep++
    }, config.animationStepMs)
}

function setWindowPosition(browserWin, posX, posY) {
    browserWin.setPosition(parseInt(posX, 10), parseInt(posY, 10))
}

/*
* Find next possible insert position (on top)
*/
function calcInsertPos() {
    if (activeNotifications.length < config.maxVisibleNotifications) {
        switch(config.startCorner) {
            case 'upper-right':
            case 'upper-left':
                nextInsertPos.y = config.corner.y + (config.totalHeight * activeNotifications.length);
                break;

            default:
            case 'lower-right':
            case 'lower-left':
                nextInsertPos.y = config.corner.y - (config.totalHeight * (activeNotifications.length + 1));
                break;
        }
    }
}

/*
* Get a window to display a notification. Use inactiveWindows or
* create a new window
* @return {Window}
*/
function getWindow() {
    return new Promise(function(resolve) {
        let notificationWindow
        // Are there still inactiveWindows?
        if (inactiveWindows.length > 0) {
            notificationWindow = inactiveWindows.pop()
            resolve(notificationWindow)
        } else {
            // Or create a new window
            let windowProperties = config.defaultWindow
            windowProperties.width = config.width
            windowProperties.height = config.height
            notificationWindow = new BrowserWindow(windowProperties)
            notificationWindow.setVisibleOnAllWorkspaces(true)
            notificationWindow.loadURL(getTemplatePath())
            notificationWindow.webContents.on('did-finish-load', function() {
                // Done
                notificationWindow.webContents.send('electron-notify-load-config', config)
                resolve(notificationWindow)
            })
        }
    })
}

function closeAll() {
    // Clear out animation Queue and close windows
    animationQueue.clear();

    activeNotifications.forEach(function(window) {
        if (window.electronNotifyOnCloseFunc) {
            window.electronNotifyOnCloseFunc({
                event: 'close-all'
            });
            // ToDo: fix this: shouldn't delete method on arg
            /* eslint-disable */
            delete window.electronNotifyOnCloseFunc;
            /* eslint-enable */
        }
        window.close();
    });

    cleanUpInactiveWindow();

    // Reset certain vars
    nextInsertPos = {};
    activeNotifications = [];
}

/**
/* once a minute, remove inactive windows to free up memory used.
 */
setInterval(cleanUpInactiveWindow, 60000);

function cleanUpInactiveWindow() {
    inactiveWindows.forEach(function(window) {
        window.close();
    });
    inactiveWindows = [];
}

function log() {
    if (config.logging === true) {
        /* eslint-disable no-console */
        console.log.apply(console, arguments);
        /* eslint-enable no-console */
    }
}

module.exports.notify = notify
// module.exports.setConfig = setConfig
module.exports.closeAll = closeAll
