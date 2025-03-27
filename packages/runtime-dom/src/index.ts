import {
  type App,
  type CreateAppFunction,
  type DefineComponent,
  DeprecationTypes,
  type Directive,
  type ElementNamespace,
  type HydrationRenderer,
  type Renderer,
  type RootHydrateFunction,
  type RootRenderFunction,
  compatUtils,
  createHydrationRenderer,
  createRenderer,
  isRuntimeOnly,
  warn,
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
// Importing from the compiler, will be tree-shaken in prod
import {
  NOOP,
  extend,
  isFunction,
  isHTMLTag,
  isMathMLTag,
  isSVGTag,
  isString,
} from '@vue/shared'
import type { TransitionProps } from './components/Transition'
import type { TransitionGroupProps } from './components/TransitionGroup'
import type { vShow } from './directives/vShow'
import type { VOnDirective } from './directives/vOn'
import type { VModelDirective } from './directives/vModel'

/**
 * This is a stub implementation to prevent the need to use dom types.
 *
 * To enable proper types, add `"dom"` to `"lib"` in your `tsconfig.json`.
 */
type DomStub = {}
type DomType<T> = typeof globalThis extends { window: unknown } ? T : DomStub

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    runtimeDOMBailTypes: DomType<Node | Window>
  }
}

declare module '@vue/runtime-core' {
  interface GlobalComponents {
    Transition: DefineComponent<TransitionProps>
    TransitionGroup: DefineComponent<TransitionGroupProps>
  }

  interface GlobalDirectives {
    vShow: typeof vShow
    vOn: VOnDirective
    vBind: VModelDirective
    vIf: Directive<any, boolean>
    VOnce: Directive
    VSlot: Directive
  }
}

const rendererOptions = /*@__PURE__*/ extend({ patchProp }, nodeOps)

// lazy create the renderer - this makes core renderer logic tree-shakable
// in case the user only imports reactivity utilities from Vue.
let renderer: Renderer<Element | ShadowRoot> | HydrationRenderer

let enabledHydration = false

function ensureRenderer() {
  return (
    renderer ||
    (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
  )
}

function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// use explicit type casts here to avoid import() calls in rolled-up d.ts
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element | ShadowRoot>

export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction

// * 创建应用
// # Vue 运行时 DOM 挂载过程分析

// 这段代码是 Vue 3 运行时 DOM 相关的核心实现，特别是应用挂载过程。我将详细解释 `createApp` 和 `mount` 方法的工作原理。

// ## 详细解释

// 1. **创建应用过程**:
//    - `createApp` 是 Vue 应用的入口点，它接收组件和props作为参数
//    - 首先调用 `ensureRenderer().createApp(...args)` 创建应用实例
//    - `ensureRenderer()` 确保渲染器已创建，如果没有则创建一个新的渲染器

// 2. **开发环境检查**:
//    - 在开发环境下，注入两个检查函数：
//      - `injectNativeTagCheck`: 检查标签是否为原生HTML/SVG/MathML标签
//      - `injectCompilerOptionsCheck`: 检查编译器选项的使用是否正确

// 3. **重写mount方法**:
//    - 保存原始的 `mount` 方法
//    - 重新定义 `app.mount` 方法，添加DOM特定的处理逻辑

// 4. **mount方法的实现**:
//    - 首先通过 `normalizeContainer` 将选择器字符串转换为实际DOM元素
//    - 检查组件定义，如果没有 `render` 函数和 `template`，则使用容器的 `innerHTML` 作为模板
//    - 在Vue 2.x兼容模式下，检查容器上是否有指令属性，并发出警告
//    - 清空容器内容（`container.textContent = ''`）
//    - 调用原始 `mount` 方法进行实际挂载，并传入命名空间信息
//    - 挂载完成后，移除 `v-cloak` 属性（用于防止闪烁）并添加 `data-v-app` 属性作为标记
//    - 返回组件实例代理

// 5. **命名空间解析**:
//    - `resolveRootNamespace` 函数检测容器元素类型，确定正确的XML命名空间（SVG或MathML）

// ## 关键点分析

// 1. **模板获取策略**:
//    - 如果组件没有定义render函数或template，Vue会使用挂载容器的innerHTML作为模板
//    - 这是一种便捷方式，但有安全风险（可能执行不可信的JS表达式）

// 2. **挂载前清空**:
//    - 挂载前会清空容器内容，确保Vue完全控制DOM渲染

// 3. **v-cloak处理**:
//    - 移除v-cloak属性，这个属性通常用于防止未编译的模板闪烁
//    - 添加data-v-app属性，标记该元素为Vue应用的根元素

// 4. **命名空间支持**:
//    - 支持SVG和MathML元素作为根容器，确保正确的XML命名空间

// 这段代码展示了Vue如何将虚拟DOM渲染系统与实际DOM操作连接起来，是Vue运行时DOM部分的核心实现。

export const createApp = ((...args) => {
  // * 万物起源
  // 创建渲染器对象
  const app = ensureRenderer().createApp(...args)

  if (__DEV__) {
    // * 注入原生标签检查
    injectNativeTagCheck(app)
    // * 注入编译器选项检查
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  // * 挂载应用
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    // 将选择器转换为实际DOM元素
    const container = normalizeContainer(containerOrSelector)
    if (!container) return

    const component = app._component
    // 如果组件没有render函数和template属性，则使用容器的innerHTML作为模板
    if (!isFunction(component) && !component.render && !component.template) {
      // __UNSAFE__
      // 原因：可能在DOM模板中执行JS表达式
      // 用户必须确保DOM模板是可信的。如果是服务器渲染的，模板不应包含任何用户数据
      component.template = container.innerHTML
      // Vue 2.x 兼容性检查
      if (__COMPAT__ && __DEV__ && container.nodeType === 1) {
        for (let i = 0; i < (container as Element).attributes.length; i++) {
          const attr = (container as Element).attributes[i]
          if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
            compatUtils.warnDeprecation(
              DeprecationTypes.GLOBAL_MOUNT_CONTAINER,
              null,
            )
            break
          }
        }
      }
    }

    // 挂载前清空容器内容
    if (container.nodeType === 1) {
      container.textContent = ''
    }
    // 调用原始mount方法进行实际挂载
    const proxy = mount(container, false, resolveRootNamespace(container))
    // 挂载完成后，移除v-cloak属性并添加data-v-app属性标记
    if (container instanceof Element) {
      container.removeAttribute('v-cloak')
      container.setAttribute('data-v-app', '')
    }
    return proxy
  }

  return app
}) as CreateAppFunction<Element>

export const createSSRApp = ((...args) => {
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true, resolveRootNamespace(container))
    }
  }

  return app
}) as CreateAppFunction<Element>

function resolveRootNamespace(
  container: Element | ShadowRoot,
): ElementNamespace {
  if (container instanceof SVGElement) {
    return 'svg'
  }
  if (
    typeof MathMLElement === 'function' &&
    container instanceof MathMLElement
  ) {
    return 'mathml'
  }
}

function injectNativeTagCheck(app: App) {
  // Inject `isNativeTag`
  // this is used for component name validation (dev only)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag),
    writable: false,
  })
}

// dev only
function injectCompilerOptionsCheck(app: App) {
  if (isRuntimeOnly()) {
    const isCustomElement = app.config.isCustomElement
    Object.defineProperty(app.config, 'isCustomElement', {
      get() {
        return isCustomElement
      },
      set() {
        warn(
          `The \`isCustomElement\` config option is deprecated. Use ` +
            `\`compilerOptions.isCustomElement\` instead.`,
        )
      },
    })

    const compilerOptions = app.config.compilerOptions
    const msg =
      `The \`compilerOptions\` config option is only respected when using ` +
      `a build of Vue.js that includes the runtime compiler (aka "full build"). ` +
      `Since you are using the runtime-only build, \`compilerOptions\` ` +
      `must be passed to \`@vue/compiler-dom\` in the build setup instead.\n` +
      `- For vue-loader: pass it via vue-loader's \`compilerOptions\` loader option.\n` +
      `- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n` +
      `- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-sfc`

    Object.defineProperty(app.config, 'compilerOptions', {
      get() {
        warn(msg)
        return compilerOptions
      },
      set() {
        warn(msg)
      },
    })
  }
}

function normalizeContainer(
  container: Element | ShadowRoot | string,
): Element | ShadowRoot | null {
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(
        `Failed to mount app: mount target selector "${container}" returned null.`,
      )
    }
    return res
  }
  if (
    __DEV__ &&
    window.ShadowRoot &&
    container instanceof window.ShadowRoot &&
    container.mode === 'closed'
  ) {
    warn(
      `mounting on a ShadowRoot with \`{mode: "closed"}\` may lead to unpredictable bugs`,
    )
  }
  return container as any
}

// Custom element support
export {
  defineCustomElement,
  defineSSRCustomElement,
  useShadowRoot,
  useHost,
  VueElement,
  type VueElementConstructor,
  type CustomElementOptions,
} from './apiCustomElement'

// SFC CSS utilities
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// DOM-only components
export { Transition, type TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  type TransitionGroupProps,
} from './components/TransitionGroup'

// **Internal** DOM-only runtime directive helpers
export {
  vModelCheckbox,
  vModelDynamic,
  vModelRadio,
  vModelSelect,
  vModelText,
} from './directives/vModel'
export { withKeys, withModifiers } from './directives/vOn'
export { vShow } from './directives/vShow'

import { initVModelForSSR } from './directives/vModel'
import { initVShowForSSR } from './directives/vShow'

let ssrDirectiveInitialized = false

/**
 * @internal
 */
export const initDirectivesForSSR: () => void = __SSR__
  ? () => {
      if (!ssrDirectiveInitialized) {
        ssrDirectiveInitialized = true
        initVModelForSSR()
        initVShowForSSR()
      }
    }
  : NOOP

// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
export * from '@vue/runtime-core'

export * from './jsx'
