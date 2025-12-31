window.boot = function () {
    var settings = window._CCSettings;
    window._CCSettings = undefined;
    var onProgress = null;

    var RESOURCES = cc.AssetManager.BuiltinBundleName.RESOURCES;
    var INTERNAL = cc.AssetManager.BuiltinBundleName.INTERNAL;
    var MAIN = cc.AssetManager.BuiltinBundleName.MAIN;

    // 【1. 全局错误拦截】防止 null 报错卡死
    window.addEventListener("unhandledrejection", function(event) {
        if (event.reason === null) event.preventDefault();
    });

    // 【2. 配置区域】
    var LOCAL_WHITELIST = [
        'internal', 'main', 'game', 'miniGameScripts', 'TEST_REMOTE_MODULE'
    ];
    var REMOTE_SERVER_ROOT = 'https://xxz-xyzw-res.hortorgames.com/'; 
    // 极简替身代码
    var DUMMY_CODE = 'console.log("[Bundle] Dummy Injected");(function(r){r.keys=function(){return[]};r.resolve=function(k){return k};return r})(function(n){return{}});';

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
    // 【核心逻辑】 V17 极速直接替身版
    // ==========================================================

    var REGEX_FULL_URL = /^(?:\w+:\/\/|\.+\/).+/;

    function customBundleDownloader(url, options, onComplete) {
        var bundleName = cc.path.basename(url);
        var isLocal = LOCAL_WHITELIST.indexOf(bundleName) !== -1;
        var base = isLocal ? (REGEX_FULL_URL.test(url) ? url : "assets/" + bundleName) : (REMOTE_SERVER_ROOT + "remote/" + bundleName);
        var version = options.version || settings.bundleVers[bundleName];
        
        var count = 0;
        var configData = null;

        // 统一完成回调
        var checkDone = function(err, data) {
            count++;
            if (count === 2) {
                // 如果 config 缺失，直接伪造，确保不崩
                if (!configData) {
                    configData = {
                        "isZip": false, "import": [], "native": [], "redirect": [], "debug": false, "extension_map": {},
                        "versions": {"import": [], "native": []},
                        "base": base + "/"
                    };
                }
                onComplete(null, configData);
            }
        };

        // 1. 下载 Config (保持尝试下载，失败则忽略)
        var configUrl = base + "/config." + (version ? version + "." : "") + "json";
        cc.assetManager.downloader.download(configUrl, configUrl, '.json', options, function(err, data) {
            if (!err) {
                configData = data;
                if (configData) configData.base = base + "/";
            }
            checkDone(null, null);
        });

        // 2. 处理 Script (核心修改：远程直接注入，不下载)
        if (isLocal) {
            var scriptUrl = base + "/index." + (version ? version + "." : "") + "js";
            cc.assetManager.downloader.downloadScript(scriptUrl, options, function(err) {
                // 本地脚本如果丢了，也没办法，只能假装成功往下走，或者报错
                if (err) console.error("Local script missing: " + scriptUrl);
                checkDone(null, null);
            });
        } else {
            // 【直接注入替身】节省网络请求
            try {
                var script = document.createElement('script');
                script.text = DUMMY_CODE;
                document.body.appendChild(script);
                setTimeout(function() { checkDone(null, null); }, 0);
            } catch (e) {
                checkDone(null, null);
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