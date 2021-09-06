import { watch } from 'vue'
import { storeKey } from './injectKey'
import { addDevtools } from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { assert } from './util'
import {
  genericSubscribe,
  getNestedState,
  installModule,
  resetStore,
  resetStoreState,
  unifyObjectStyle
} from './store-util'

export function createStore (options) {
  return new Store(options)
}

export class Store {
  constructor(options = {}) {
    if (__DEV__) {
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false,
      devtools
    } = options

    // store internal state
    this._committing = false // * 正在 commit 中，执行 mutation 会置为 true
    this._actions = Object.create(null)
    this._actionSubscribers = []
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._makeLocalGettersCache = Object.create(null)
    this._devtools = devtools

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict
    // ? 根 module 的 state
    const state = this._modules.root.state

    // ? 初始化根 module
    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    // ? 初始化 state，使用 reactive 实现响应式
    // initialize the store state, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreState(this, state)

    // apply plugins
    // ? 调用插件
    plugins.forEach(plugin => plugin(this))
  }
  // ! 注册函数: app.use() 时调用该方法
  // ! 将 store 对象注册到 Vue 实例中
  install (app, injectKey) {
    // ? 在组合API中使用，将 store 注册到 provide 中
    // ? 通过 inject 可以读取到 useStore
    app.provide(injectKey || storeKey, this)
    // ? 在Options API中使用
    app.config.globalProperties.$store = this

    const useDevtools = this._devtools !== undefined
      ? this._devtools
      : __DEV__ || __VUE_PROD_DEVTOOLS__

    if (useDevtools) {
      addDevtools(app, this)
    }
  }
  // ! 根 state 对象
  get state () {
    return this._state.data
  }
  // ! 拦截
  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }
  // ! 提交 mutation, options 可以有 root: true，允许在命名空间模块里提交根 mutation
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // * mutation 方法
    const entry = this._mutations[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // * 执行 store 上的 mutation
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }
  // ! 分发 action，同样 options 中的 root 可以为 true。
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }
  // ! 订阅 store 的 mutation。fn 会在每个 mutation 完成后调用，接收 mutation 和 state。
  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }
  // ! 订阅 store 的 action, fn 两个参数 action 和 state
  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }
  // ! 响应式的侦听 getter 返回值，值改变时调用 cb 函数
  // ! 停止只需调用 watch 返回函数。
  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return watch(() => getter(this.state, this.getters), cb, Object.assign({}, options))
  }
  // ! 替换 store 根状态
  replaceState (state) {
    this._withCommit(() => {
      this._state.data = state
    })
  }
  // ! 注册一个动态模块
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreState(this, this.state)
  }
  // ! 卸载一个动态模块
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      delete parentState[path[path.length - 1]]
    })
    resetStore(this)
  }
  // ! 检测模块的名称是否被注册过
  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }
  // ! 热替换新的 action 和 mutation
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}
