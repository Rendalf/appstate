/* appstate.js - Version: 1.0.0 - Author: Markuplab (Kirill Kaysarov) */
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.appstate = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = {
  /**
   * Signal factory. Create signal functions with deep analyzed structure.
   * Every signal run, have full meta information about every action called within signal.
   * Before create, signal will be analyzed for correct definition.
   *
   * @example:
   *  var actions = [
   *    syncAction,
   *    [
   *      asyncAction,
   *      {
   *        success: [successSyncAction],
   *        error: [errorSyncAction]
   *      }
   *    ]
   *  ];
   *
   *  var name = 'example';
   *  var signal = appstate.create(name, actions);
   *  var tree = new Baobab;
   *
   *  // You can run signal as function that return Promise with results
   *  signal(tree);
   *
   * Every function in this example is pure.
   * That have 3 args: signalArgs, state, output.
   * All args passed automatically when you run signal.
   *
   * @param {String} name
   * @param {Array} actions
   * @return {Function}
   */
  create: function create(name, actions) {
    analyze(name, actions);

    return function (state) {
      var args = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

      return new Promise(function (resolve, reject) {
        checkArgs(args, name);
        // Transform signal definition to flatten array
        var tree = staticTree(actions);

        // Create signal definition
        var signal = {
          name: name, args: args,
          branches: tree.branches,
          isExecuting: true,
          duration: 0
        };

        var start = Date.now();
        var promise = { resolve: resolve, reject: reject };

        // Start recursive run tree branches
        runBranch(0, { tree: tree, args: args, signal: signal, promise: promise, start: start, state: state });
      });
    };
  }
};

/**
 * Run tree branch, or resolve signal
 * if no more branches in recursion.
 * @param {Number} index
 * @param {Object} options
 * @param {Object} options.tree
 * @param {Object} options.args
 * @param {Object} options.signal
 * @param {Object} options.promise
 * @param {Date}   options.start
 * @param {Baobab} options.state
 */
function runBranch(index, options) {
  var tree = options.tree;
  var signal = options.signal;
  var start = options.start;
  var promise = options.promise;

  var currentBranch = tree.branches[index];

  if (!currentBranch && tree.branches === signal.branches) {
    if (tree.branches[index - 1]) {
      tree.branches[index - 1].duration = Date.now() - start;
    }

    signal.isExecuting = false;

    if (promise) {
      promise.resolve(signal);
    }

    return;
  }

  if (!currentBranch) {
    return;
  }

  return Array.isArray(currentBranch) ? runAsyncBranch(index, currentBranch, options) : runSyncBranch(index, currentBranch, options);
}

/**
 * Run async branch
 * @param {Number} index
 * @param {Object} currentBranch
 * @param {Object} options
 * @param {Object} options.tree
 * @param {Object} options.args
 * @param {Object} options.signal
 * @param {Object} options.promise
 * @param {Date}   options.start
 * @param {Baobab} options.state
 * @returns {Promise}
 */
function runAsyncBranch(index, currentBranch, options) {
  var tree = options.tree;
  var args = options.args;
  var signal = options.signal;
  var state = options.state;
  var promise = options.promise;
  var start = options.start;

  var promises = currentBranch.map(function (action) {
    var actionFunc = tree.actions[action.actionIndex];
    var actionArgs = createActionArgs(args, action, state, true);

    action.isExecuting = true;
    action.args = merge({}, args);

    var next = createNextAsyncAction(actionFunc);
    actionFunc.apply(null, actionArgs.concat(next.fn));

    return next.promise.then(function (result) {
      action.hasExecuted = true;
      action.isExecuting = false;
      action.output = result.args;

      merge(args, result.args);

      if (result.path) {
        var output = action.outputs[result.path];

        return runBranch(0, {
          args: args, signal: signal, state: state, start: start, promise: promise,
          tree: {
            actions: tree.actions,
            branches: output
          }
        });
      }
    });
  });

  return Promise.all(promises).then(function () {
    return runBranch(index + 1, options);
  });
}

/**
 * Run sync branch
 * @param {Number} index
 * @param {Object} currentBranch
 * @param {Object} options
 * @param {Object} options.tree
 * @param {Object} options.args
 * @param {Object} options.signal
 * @param {Object} options.promise
 * @param {Date}   options.start
 * @param {Baobab} options.state
 * @returns {Promise|undefined}
 */
function runSyncBranch(index, currentBranch, options) {
  var args = options.args;
  var tree = options.tree;
  var signal = options.signal;
  var state = options.state;
  var start = options.start;
  var promise = options.promise;

  try {
    var action = currentBranch;
    var actionFunc = tree.actions[action.actionIndex];
    var actionArgs = createActionArgs(args, action, state, false);

    action.mutations = [];
    action.args = merge({}, args);

    var next = createNextSyncAction(actionFunc);
    actionFunc.apply(null, actionArgs.concat(next));

    var result = next._result || {};
    merge(args, result.args);

    action.isExecuting = false;
    action.hasExecuted = true;
    action.output = result.args;

    if (result.path) {
      action.outputPath = result.path;
      var output = action.outputs[result.path];

      var result = runBranch(0, {
        args: args, signal: signal, state: state, start: start, promise: promise,
        tree: {
          actions: tree.actions,
          branches: output
        }
      });

      if (result && result.then) {
        return result.then(function () {
          return runBranch(index + 1, options);
        });
      } else {
        return runBranch(index + 1, options);
      }
    } else {
      return runBranch(index + 1, options);
    }
  } catch (e) {
    console.log(e.stack);
  }
}

/**
 * Add output paths to next function.
 * It's method allow define custom outputs for every action.
 * By default, allow 2 outputs: success and error.
 * You can define custom output this way:
 *
 * @example
 *  function action (args, state, output) {
   *    output.custom();
   *  }
 *
 *  action.outputs = ['success', 'error', 'custom'];
 *
 * @param {Function} action
 * @param {Function} next
 * @returns {*}
 */
function addOutputs(action, next) {
  if (!action.outputs) {
    next.success = next.bind(null, 'success');
    next.error = next.bind(null, 'error');
  } else if (Array.isArray(action.outputs)) {
    action.outputs.forEach(function (key) {
      next[key] = next.bind(null, key);
    });
  } else {
    Object.keys(action.outputs).forEach(function (key) {
      next[key] = next.bind(null, key);
    });
  }

  return next;
}

/**
 * Create next function in signal chain.
 * It's unified method for async and sync actions.
 * @param {Function} action
 * @param {Function} [resolver]
 * @returns {Function}
 */
function createNextFunction(action, resolver) {
  return function next() {
    var path = typeof arguments[0] === 'string' ? arguments[0] : null;
    var arg = path ? arguments[1] : arguments[0];

    var result = {
      path: path ? path : action.defaultOutput,
      args: arg
    };

    if (resolver) {
      resolver(result);
    } else {
      next._result = result;
    }
  };
}

/**
 * Create next sync action
 * @param {Function} actionFunc
 * @returns {Function}
 */
function createNextSyncAction(actionFunc) {
  var next = createNextFunction(actionFunc);
  next = addOutputs(actionFunc, next);

  return next;
}

/**
 * Create next sync action
 * @param {Function} actionFunc
 * @returns {{}}
 */
function createNextAsyncAction(actionFunc) {
  var resolver = null;
  var promise = new Promise(function (resolve) {
    return resolver = resolve;
  });
  var fn = createNextFunction(actionFunc, resolver);
  addOutputs(actionFunc, fn);

  return { fn: fn, promise: promise };
}

/**
 * Create action arguments for every action.
 * State object exposed as special patched collection of
 * mutation/accessors functions of Baobab Tree.
 * @param {*} args
 * @param {Object} action
 * @param {Object} state
 * @param {Boolean} isAsync
 * @returns {Array}
 */
function createActionArgs(args, action, state, isAsync) {
  var stateMethods = getStateMutatorsAndAccessors(state, action, isAsync);
  return [args, stateMethods];
}

/**
 * Get state mutators and accessors
 * Each mutation will save in action descriptor.
 * This method allow add ability
 * to gather information about call every function.
 * @param {Object} state
 * @param {Object} action
 * @param {Boolean} isAsync
 * @return {Object}
 */
function getStateMutatorsAndAccessors(state, action, isAsync) {
  var mutators = ['apply', 'concat', 'deepMerge', 'push', 'merge', 'unset', 'set', 'splice', 'unshift'];

  var accessors = ['get', 'exists'];

  var methods = [];

  if (isAsync) {
    methods = methods.concat(accessors);
  } else {
    methods = methods.concat(mutators);
    methods = methods.concat(accessors);
  }

  var stateMethods = Object.create(null);
  methods.reduce(function (stateMethods, methodName) {
    var method = state[methodName].bind(state);

    stateMethods[methodName] = function () {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      var path = [];
      var firstArg = args[0];

      if (Array.isArray(firstArg)) {
        path = args.shift();
      } else if (typeof firstArg === 'string') {
        path = [args.shift()];
      }

      if (args.length === 0) {
        return method.apply(null, [path.slice()]);
      }

      action.mutations.push({
        name: methodName,
        path: path.slice(),
        args: args
      });

      return method.apply(null, [path.slice()].concat(args));
    };

    return stateMethods;
  }, stateMethods);

  return stateMethods;
}

/**
 * Transform signal actions to static tree.
 * Every function will be exposed as object definition,
 * that will store meta information and function call results.
 * @param {Array} signalActions
 * @returns {{ actions: [], branches: [] }}
 */
function staticTree(signalActions) {
  var actions = [];
  var branches = transformBranch(signalActions, [], [], actions, false);
  return { actions: actions, branches: branches };
}

/**
 * Transform tree branch
 * @param {Function} action
 * @param {Array}    args
 * @param {Array|Function}    args.parentAction
 * @param {Array}    args.path
 * @param {Array}    args.actions
 * @param {Boolean}  args.isSync
 * @return {Object}
 */
function transformBranch(action) {
  for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
    args[_key2 - 1] = arguments[_key2];
  }

  return Array.isArray(action) ? transformAsyncBranch.apply(null, [action].concat(args)) : transformSyncBranch.apply(null, [action].concat(args));
}

/**
 * Transform action to async branch
 * @param {Function} action
 * @param {Array|Function} parentAction
 * @param {Array} path
 * @param {Array} actions
 * @param {Boolean} isSync
 * @returns {*}
 */
function transformAsyncBranch(action, parentAction, path, actions, isSync) {
  action = action.slice();
  isSync = !isSync;
  return action.map(function (subAction, index) {
    path.push(index);
    var result = transformBranch(subAction, action, path, actions, isSync);
    path.pop();
    return result;
  }).filter(function (action) {
    return !!action;
  });
}

/**
 * Transform action to sync branch
 * @param {Function} action
 * @param {Array|Function} parentAction
 * @param {Array} path
 * @param {Array} actions
 * @param {Boolean} isSync
 * @returns {{
 *    name: *, args: {}, output: null, duration: number,
 *    mutations: Array, isAsync: boolean, outputPath: null,
 *    isExecuting: boolean, hasExecuted: boolean,
 *    path: *, outputs: null, actionIndex: number
 *  }|undefined}
 */
function transformSyncBranch(action, parentAction, path, actions, isSync) {
  if (typeof action !== 'function') {
    return;
  }

  var branch = {
    name: getFunctionName(action),
    args: {},
    output: null,
    duration: 0,
    mutations: [],
    isAsync: !isSync,
    outputPath: null,
    isExecuting: false,
    hasExecuted: false,
    path: path.slice(),
    outputs: null,
    actionIndex: actions.indexOf(action) === -1 ? actions.push(action) - 1 : actions.indexOf(action)
  };

  var nextAction = parentAction[parentAction.indexOf(action) + 1];
  if (!Array.isArray(nextAction) && typeof nextAction === 'object') {
    parentAction.splice(parentAction.indexOf(nextAction), 1);

    branch.outputs = Object.keys(nextAction).reduce(function (paths, key) {
      path = path.concat('outputs', key);
      paths[key] = transformBranch(nextAction[key], parentAction, path, actions, false);
      path.pop();
      path.pop();
      return paths;
    }, {});
  }

  return branch;
}

/**
 * Analyze actions for errors
 * @param {String} signalName
 * @param {Array} actions
 */
function analyze(signalName, actions) {
  actions.forEach(function (action, index) {
    if (typeof action === 'undefined' || typeof action === 'string') {
      throw new Error('\n            State: Action number "' + index + '" in signal "' + signalName + '" does not exist.\n            Check that you have spelled it correctly!\n          ');
    }

    if (Array.isArray(action)) {
      analyze(signalName, action);
    }
  });
}

/**
 * Check arguments
 * @param {*} args
 * @param {String} name
 */
function checkArgs(args, name) {
  try {
    JSON.stringify(args);
  } catch (e) {
    throw new Error('State - Could not serialize arguments to signal. Please check signal ' + name);
  }
}

/**
 * Get function name
 * @param {Function} fn
 * @returns {String}
 */
function getFunctionName(fn) {
  var name = fn.toString();
  name = name.substr('function '.length);
  name = name.substr(0, name.indexOf('('));
  return name;
}

/**
 * Merge two objects
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function merge(target, source) {
  source = source || {};
  return Object.keys(source).reduce(function (target, key) {
    target[key] = source[key];
    return target;
  }, target);
}

},{}]},{},[1])(1)
});