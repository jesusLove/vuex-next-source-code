import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method
// ! Module 类，描述其结构
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // ?Store some children item (存储子 module)
    // ?对象方式存储：key: 为属性名如 ‘products’，value: 模块对象
    this._children = Object.create(null)
    // ?存储原始 modules 对象: namespaced（命名空间）、state、mutation、action、getters...
    this._rawModule = rawModule
    const rawState = rawModule.state
    // ?存储 state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // ! children 的增删改查
  addChild (key, module) {
    this._children[key] = module
  }

  removeChild (key) {
    delete this._children[key]
  }

  getChild (key) {
    return this._children[key]
  }

  hasChild (key) {
    return key in this._children
  }
  // ! 更新原始对象
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }
  // ! ==== 提供 modules、getter、action、mutation 遍历方法

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
