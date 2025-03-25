// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
import { initDev } from './dev'
import {
  type CompilerError,
  type CompilerOptions,
  compile,
} from '@vue/compiler-dom'
import {
  type RenderFunction,
  registerRuntimeCompiler,
  warn,
} from '@vue/runtime-dom'
import * as runtimeDom from '@vue/runtime-dom'
import {
  NOOP,
  extend,
  genCacheKey,
  generateCodeFrame,
  isString,
} from '@vue/shared'
import type { InternalRenderFunction } from 'packages/runtime-core/src/component'

if (__DEV__) {
  initDev()
}

const compileCache: Record<string, RenderFunction> = Object.create(null)

/**
 *
 * @param template
 * @param options
 * @returns 返回一个函数,这个函数返回vnode
 */
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions,
): RenderFunction {
  if (!isString(template)) {
    if (template.nodeType) {
      template = template.innerHTML
    } else {
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }

  // `genCacheKey`函数来自`@vue/shared`包，
  // 它会根据模板内容和编译选项生成一个唯一的字符串作为缓存键。
  // 这样可以确保相同的模板+选项组合会得到相同的缓存键，而不同的组合会得到不同的缓存键。
  const key = genCacheKey(template, options)
  const cached = compileCache[key]
  if (cached) {
    return cached
  }
  // 如果模板字符串以`#`开头，表示它是一个选择器字符串，
  // 会尝试在当前文档中查找对应的DOM元素，并将其innerHTML内容作为模板内容。
  if (template[0] === '#') {
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    template = el ? el.innerHTML : ``
  }

  // `extend`函数来自`@vue/shared`包，
  // 它会合并两个对象，并返回一个新的对象，
  // 新对象会包含两个对象的所有属性。
  const opts = extend(
    {
      hoistStatic: true,
      onError: __DEV__ ? onError : undefined,
      onWarn: __DEV__ ? e => onError(e, true) : NOOP,
    } as CompilerOptions,
    options,
  )

  // 如果`opts.isCustomElement`为`false`，并且`customElements`存在，
  // 则将`opts.isCustomElement`设置为一个新的函数，
  // 这个函数会检查给定的标签是否在`customElements`中存在。
  if (!opts.isCustomElement && typeof customElements !== 'undefined') {
    opts.isCustomElement = tag => !!customElements.get(tag)
  }

  // code是生成dom的方法.toString形式
  // 调用compile方法,生成dom的方法.toString形式
  const { code } = compile(template, opts)

  // 定义一个错误处理函数,当编译模板时发生错误时,会调用这个函数
  function onError(err: CompilerError, asWarning = false) {
    const message = asWarning
      ? err.message
      : `Template compilation error: ${err.message}`
    const codeFrame =
      err.loc &&
      // 生成错误代码的代码帧
      generateCodeFrame(
        template as string,
        err.loc.start.offset,
        err.loc.end.offset,
      )
    warn(codeFrame ? `${message}\n${codeFrame}` : message)
  }

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  const render = (
    __GLOBAL__ ? new Function(code)() : new Function('Vue', code)(runtimeDom)
  ) as RenderFunction
  // mark the function as runtime compiled
  ;(render as InternalRenderFunction)._rc = true

  return (compileCache[key] = render)
}

// 注册compileToFunction方法
registerRuntimeCompiler(compileToFunction)

// 导出compileToFunction方法,并命名为compile
export { compileToFunction as compile }
export * from '@vue/runtime-dom'
