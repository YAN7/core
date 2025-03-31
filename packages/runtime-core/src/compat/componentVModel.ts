import { ShapeFlags, extend } from '@vue/shared'
import type { ComponentInternalInstance, ComponentOptions } from '../component'
import { ErrorCodes, callWithErrorHandling } from '../errorHandling'
import type { VNode } from '../vnode'
import { popWarningContext, pushWarningContext } from '../warning'
import {
  DeprecationTypes,
  isCompatEnabled,
  warnDeprecation,
} from './compatConfig'

export const compatModelEventPrefix = `onModelCompat:`

// 用于记录已经发出警告的组件类型,避免重复警告
const warnedTypes = new WeakSet()

// 将 v3 的 v-model 转换为 v2 的 modelValue 和 onModelCompat:input
export function convertLegacyVModelProps(vnode: VNode): void {
  const { type, shapeFlag, props, dynamicProps } = vnode
  const comp = type as ComponentOptions
  if (shapeFlag & ShapeFlags.COMPONENT && props && 'modelValue' in props) {
    if (
      !isCompatEnabled(
        DeprecationTypes.COMPONENT_V_MODEL,
        // this is a special case where we want to use the vnode component's
        // compat config instead of the current rendering instance (which is the
        // parent of the component that exposes v-model)
        { type } as any,
      )
    ) {
      return
    }

    if (__DEV__ && !warnedTypes.has(comp)) {
      // 将当前组件的 vnode 推入警告上下文
      pushWarningContext(vnode)
      warnDeprecation(DeprecationTypes.COMPONENT_V_MODEL, { type } as any, comp)
      popWarningContext()
      warnedTypes.add(comp)
    }

    // v3 compiled model code -> v2 compat props
    // modelValue -> value
    // onUpdate:modelValue -> onModelCompat:input
    const model = comp.model || {}
    applyModelFromMixins(model, comp.mixins)
    const { prop = 'value', event = 'input' } = model
    if (prop !== 'modelValue') {
      props[prop] = props.modelValue
      delete props.modelValue
    }
    // important: update dynamic props
    if (dynamicProps) {
      dynamicProps[dynamicProps.indexOf('modelValue')] = prop
    }
    props[compatModelEventPrefix + event] = props['onUpdate:modelValue']
    delete props['onUpdate:modelValue']
  }
}

/**
 * 从混入(mixins)中应用 v-model 相关配置
 * @param model - 当前组件的 model 配置对象
 * @param mixins - 可选的混入选项数组
 */
function applyModelFromMixins(model: any, mixins?: ComponentOptions[]) {
  // 如果存在 mixins 数组
  if (mixins) {
    // 遍历每个 mixin 选项
    mixins.forEach(m => {
      // 如果当前 mixin 包含 model 配置，则合并到目标 model 对象中
      if (m.model) extend(model, m.model)

      // 递归处理嵌套的 mixins
      // 因为 mixin 中可能还包含其他 mixins，需要递归合并它们的 model 配置
      if (m.mixins) applyModelFromMixins(model, m.mixins)
    })
  }
}

export function compatModelEmit(
  instance: ComponentInternalInstance,
  event: string,
  args: any[],
): void {
  if (!isCompatEnabled(DeprecationTypes.COMPONENT_V_MODEL, instance)) {
    return
  }
  const props = instance.vnode.props
  const modelHandler = props && props[compatModelEventPrefix + event]
  if (modelHandler) {
    callWithErrorHandling(
      modelHandler,
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args,
    )
  }
}
