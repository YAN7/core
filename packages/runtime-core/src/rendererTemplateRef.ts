import type { SuspenseBoundary } from './components/Suspense'
import type { VNode, VNodeNormalizedRef, VNodeNormalizedRefAtom } from './vnode'
import {
  EMPTY_OBJ,
  ShapeFlags,
  hasOwn,
  isArray,
  isFunction,
  isString,
  remove,
} from '@vue/shared'
import { isAsyncWrapper } from './apiAsyncComponent'
import { warn } from './warning'
import { isRef, toRaw } from '@vue/reactivity'
import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import type { SchedulerJob } from './scheduler'
import { queuePostRenderEffect } from './renderer'
import { type ComponentOptions, getComponentPublicInstance } from './component'
import { knownTemplateRefs } from './helpers/useTemplateRef'

/**
 * 处理模板引用(template ref)的函数
 * @param rawRef - 规范化后的 VNode ref 对象
 * @param oldRawRef - 旧的 ref 对象(用于对比更新)
 * @param parentSuspense - 父级 Suspense 组件
 * @param vnode - 当前虚拟节点
 * @param isUnmount - 是否是卸载操作
 */
export function setRef(
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode,
  isUnmount = false,
): void {
  // 处理数组形式的 ref
  if (isArray(rawRef)) {
    rawRef.forEach((r, i) =>
      setRef(
        r,
        oldRawRef && (isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
        parentSuspense,
        vnode,
        isUnmount,
      ),
    )
    return
  }

  // 处理异步组件的特殊情况
  if (isAsyncWrapper(vnode) && !isUnmount) {
    // #4999 如果异步组件已经被 KeepAlive 缓存并解析完成
    // 需要将 ref 设置到内部组件上
    if (
      vnode.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE &&
      (vnode.type as ComponentOptions).__asyncResolved &&
      vnode.component!.subTree.component
    ) {
      setRef(rawRef, oldRawRef, parentSuspense, vnode.component!.subTree)
    }
    return
  }

  // 获取 ref 的值
  // 对于有状态组件，获取其公共实例
  // 对于其他情况，获取 DOM 元素
  const refValue =
    vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
      ? getComponentPublicInstance(vnode.component!)
      : vnode.el
  const value = isUnmount ? null : refValue

  const { i: owner, r: ref } = rawRef

  // 开发环境下检查 ref owner 上下文
  if (__DEV__ && !owner) {
    warn(
      `Missing ref owner context. ref cannot be used on hoisted vnodes. ` +
        `A vnode with ref must be created inside the render function.`,
    )
    return
  }

  const oldRef = oldRawRef && (oldRawRef as VNodeNormalizedRefAtom).r
  const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
  const setupState = owner.setupState
  const rawSetupState = toRaw(setupState)

  // 检查是否可以在 setup 状态中设置 ref
  const canSetSetupRef =
    setupState === EMPTY_OBJ
      ? () => false
      : (key: string) => {
          if (__DEV__) {
            // 开发环境下的警告检查
            if (hasOwn(rawSetupState, key) && !isRef(rawSetupState[key])) {
              warn(
                `Template ref "${key}" used on a non-ref value. ` +
                  `It will not work in the production build.`,
              )
            }
            if (knownTemplateRefs.has(rawSetupState[key] as any)) {
              return false
            }
          }
          return hasOwn(rawSetupState, key)
        }

  // 如果旧的 ref 存在且与新的 ref 不同，清除旧的 ref
  if (oldRef != null && oldRef !== ref) {
    if (isString(oldRef)) {
      refs[oldRef] = null
      if (canSetSetupRef(oldRef)) {
        setupState[oldRef] = null
      }
    } else if (isRef(oldRef)) {
      oldRef.value = null
    }
  }

  // 处理函数形式的 ref
  if (isFunction(ref)) {
    callWithErrorHandling(ref, owner, ErrorCodes.FUNCTION_REF, [value, refs])
  } else {
    const _isString = isString(ref)
    const _isRef = isRef(ref)

    // 处理字符串形式或 ref 对象形式的引用
    if (_isString || _isRef) {
      const doSet = () => {
        if (rawRef.f) {
          // 处理函数式 ref
          const existing = _isString
            ? canSetSetupRef(ref)
              ? setupState[ref]
              : refs[ref]
            : ref.value
          if (isUnmount) {
            // 卸载时移除引用
            isArray(existing) && remove(existing, refValue)
          } else {
            // 设置或更新引用
            if (!isArray(existing)) {
              if (_isString) {
                refs[ref] = [refValue]
                if (canSetSetupRef(ref)) {
                  setupState[ref] = refs[ref]
                }
              } else {
                ref.value = [refValue]
                if (rawRef.k) refs[rawRef.k] = ref.value
              }
            } else if (!existing.includes(refValue)) {
              existing.push(refValue)
            }
          }
        } else if (_isString) {
          // 直接设置字符串形式的 ref
          refs[ref] = value
          if (canSetSetupRef(ref)) {
            setupState[ref] = value
          }
        } else if (_isRef) {
          // 设置 ref 对象的值
          ref.value = value
          if (rawRef.k) refs[rawRef.k] = value
        } else if (__DEV__) {
          warn('Invalid template ref type:', ref, `(${typeof ref})`)
        }
      }

      if (value) {
        // #1789: 对于非 null 值，在渲染后设置
        // null 值表示这是一个卸载操作，不应覆盖具有相同键的其他 ref
        ;(doSet as SchedulerJob).id = -1
        queuePostRenderEffect(doSet, parentSuspense)
      } else {
        doSet()
      }
    } else if (__DEV__) {
      warn('Invalid template ref type:', ref, `(${typeof ref})`)
    }
  }
}
