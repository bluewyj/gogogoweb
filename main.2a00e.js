window.boot = function () {
    var settings = window._CCSettings;
    window._CCSettings = undefined;
    var onProgress = null;

    var RESOURCES = cc.AssetManager.BuiltinBundleName.RESOURCES;
    var INTERNAL = cc.AssetManager.BuiltinBundleName.INTERNAL;
    var MAIN = cc.AssetManager.BuiltinBundleName.MAIN;

    // ==========================================================
    // 【1. 配置区域】
    // ==========================================================
    
    // 1. 本地白名单 (Local Whitelist)
    var LOCAL_WHITELIST = [
        'internal', 'main', 'resources', 'game', 'start_scene', 
        'miniGameScripts', 'TEST_REMOTE_MODULE'
    ];

    // 2. 远程服务器根目录
    var REMOTE_SERVER_ROOT = 'https://xxz-xyzw-res.hortorgames.com/'; 
    
    // 3. 通用替身代码 (V14)
    var DUMMY_CODE = 'console.log("[Remote] Virtual Module Injected");(function(r){r.keys=function(){return[]};r.resolve=function(k){return k};return r})(function(n){return{}});';

    // ==========================================================
    // 标准启动逻辑
    // ==========================================================
    function setLoadingDisplay () {
        var splash = document.getElementById('splash');
        var progressBar = splash.querySelector('.progress-bar span');
        onProgress = function (finish, total) {
            var percent = 100 * finish / total;
            if (progressBar) progressBar.style.width = percent.toFixed(2) + '%';
        };
        splash.style.display = 'block';
        progressBar.style.width = '0%';
        cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function () {
            splash.style.display = 'none';
        });
    }

    var onStart = function () {
        cc.view.enableRetina(true);
        cc.view.resizeWithBrowserSize(true);
        if (cc.sys.isBrowser) { /* setLoadingDisplay(); */ }
        if (cc.sys.isMobile) {
            if (settings.orientation === 'landscape') cc.view.setOrientation(cc.macro.ORIENTATION_LANDSCAPE);
            else if (settings.orientation === 'portrait') cc.view.setOrientation(cc.macro.ORIENTATION_PORTRAIT);
            cc.view.enableAutoFullScreen([
                cc.sys.BROWSER_TYPE_BAIDU, cc.sys.BROWSER_TYPE_BAIDU_APP, cc.sys.BROWSER_TYPE_WECHAT,
                cc.sys.BROWSER_TYPE_MOBILE_QQ, cc.sys.BROWSER_TYPE_MIUI, cc.sys.BROWSER_TYPE_HUAWEI, cc.sys.BROWSER_TYPE_UC,
            ].indexOf(cc.sys.browserType) < 0);
        }
        if (cc.sys.isBrowser && cc.sys.os === cc.sys.OS_ANDROID) {
            cc.assetManager.downloader.maxConcurrency = 2;
            cc.assetManager.downloader.maxRequestsPerFrame = 2;
        }

        var launchScene = settings.launchScene;
        var bundle = cc.assetManager.bundles.find(function (b) { return b.getSceneInfo(launchScene); });
        bundle.loadScene(launchScene, null, onProgress, function (err, scene) {
            if (!err) {
                cc.director.runSceneImmediate(scene);
                if (cc.sys.isBrowser) {
                    var canvas = document.getElementById('GameCanvas');
                    canvas.style.visibility = '';
                    var div = document.getElementById('GameDiv');
                    if (div) div.style.backgroundImage = '';
                    console.log('Success to load scene: ' + launchScene);
                }
            }
        });
    };

    var option = {
        id: 'GameCanvas',
        debugMode: settings.debug ? cc.debug.DebugMode.INFO : cc.debug.DebugMode.ERROR,
        showFPS: settings.debug,
        frameRate: 30,
        groupList: settings.groupList,
        collisionMatrix: settings.collisionMatrix,
    };

    cc.assetManager.init({ 
        bundleVers: settings.bundleVers,
        remoteBundles: settings.remoteBundles,
        server: settings.server
    });

    // ==========================================================
    // 【核心逻辑】 V14 强力容错版 Bundle 下载器
    // ==========================================================

    var REGEX_FULL_URL = /^(?:\w+:\/\/|\.+\/).+/;

    function customBundleDownloader(url, options, onComplete) {
        var bundleName = cc.path.basename(url);
        
        // 1. 严格判定
        var isLocal = false;
        for (var i = 0; i < LOCAL_WHITELIST.length; i++) {
            if (bundleName === LOCAL_WHITELIST[i]) {
                isLocal = true;
                break;
            }
        }

        // 2. 构造路径
        var base = "";
        if (isLocal) {
            base = REGEX_FULL_URL.test(url) ? url : ("assets/" + bundleName);
        } else {
            base = REMOTE_SERVER_ROOT + "remote/" + bundleName;
        }

        var version = options.version || settings.bundleVers[bundleName];
        var count = 0;
        var configData = null;

        var checkDone = function(err, data) {
            if (err) {
                // 【V14 关键修改】如果出错，不要立即报错，尝试掩盖
                console.warn("[Bundle] Warning: " + bundleName + " error suppressed.", err);
                if (count < 2) {
                     // 如果是任何一步出错了，我们都算它完成，但是数据可能是空的
                     // 这能防止 Promise Reject
                }
            }
            count++;
            if (count === 2) {
                // 如果 config 没下载下来，造一个假的，防止 crash
                if (!configData) {
                    configData = {
                        "isZip": false,
                        "import": [],
                        "native": [],
                        "versions": {"import": [], "native": []},
                        "redirect": [],
                        "debug": false,
                        "extension_map": {},
                        "base": base + "/" // 哪怕是假的，也要把 base 设对
                    };
                }
                onComplete(null, configData);
            }
        };

        // 3. 下载 config.json
        var configUrl = base + "/config." + (version ? version + "." : "") + "json";
        
        cc.assetManager.downloader.download(configUrl, configUrl, '.json', options, function(err, data) {
            if (err) {
                console.warn("[Bundle] Config 404 handled: " + configUrl);
                // 传 null 给 checkDone，视为“无致命错误”
                checkDone(null, null); 
            } else {
                configData = data;
                if (configData) configData.base = base + "/"; 
                checkDone(null, data);
            }
        });

        // 4. 下载 index.js
        if (isLocal) {
            var scriptUrl = base + "/index." + (version ? version + "." : "") + "js";
            cc.assetManager.downloader.downloadScript(scriptUrl, options, function(err) {
                checkDone(err, null);
            });
        } else {
            try {
                var script = document.createElement('script');
                script.text = DUMMY_CODE; 
                script.id = "dummy-" + bundleName;
                document.body.appendChild(script);
                setTimeout(function() { checkDone(null, null); }, 0);
            } catch (e) {
                checkDone(null, null); // 即使注入失败也假装成功
            }
        }
    }

    cc.assetManager.downloader.register('bundle', customBundleDownloader);

    // ==========================================================

    var bundleRoot = [INTERNAL];
    settings.hasResourcesBundle && bundleRoot.push(RESOURCES);

    var count = 0;
    function cb (err) {
        if (err) return console.error(err.message, err.stack);
        count++;
        if (count === bundleRoot.length + 1) {
            cc.assetManager.loadBundle(MAIN, function (err) {
                if (!err) cc.game.run(option, onStart);
            });
        }
    }

    cc.assetManager.loadScript(settings.jsList.map(function (x) { return 'src/' + x;}), cb);

    for (var i = 0; i < bundleRoot.length; i++) {
        cc.assetManager.loadBundle(bundleRoot[i], cb);
    }
};

if (window.jsb) {
    var isRuntime = (typeof loadRuntime === 'function');
    if (isRuntime) {
        require('src/settings.js');
        require('src/cocos2d-runtime.js');
        if (CC_PHYSICS_BUILTIN || CC_PHYSICS_CANNON) {
            require('src/physics.js');
        }
        require('jsb-adapter/engine/index.js');
    }
    else {
        require('src/settings.js');
        require('src/cocos2d-jsb.js');
        if (CC_PHYSICS_BUILTIN || CC_PHYSICS_CANNON) {
            require('src/physics.js');
        }
        require('jsb-adapter/jsb-engine.js');
    }

    cc.macro.CLEANUP_IMAGE_CACHE = true;
    window.boot();
}