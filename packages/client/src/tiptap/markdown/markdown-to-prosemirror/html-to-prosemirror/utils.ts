import { AllExtensions } from './all-kit';

/**
 * 通过 tiptap extension 的配置从 DOM 节点上获取属性值
 * @param element
 * @param ret
 * @param config
 * @returns
 */
const getAttribute = (
  element: HTMLElement,
  ret = {},
  config: Record<string, { default: unknown; parseHTML?: (element: HTMLElement) => Record<string, unknown> }>
) => {
  return Object.keys(config).reduce((accu, key) => {
    const conf = config[key];
    accu[key] = conf.default;

    if (conf.parseHTML) {
      accu[key] = conf.parseHTML(element);
    }

    return accu;
  }, ret);
};

export const getAttributes = (name: string, element: HTMLElement): Record<string, unknown> => {
  const ext = AllExtensions.find((ext) => ext && ext.name === name);

  if (!ext) return {};

  let { config } = ext;
  let parent = ext && ext.parent;

  if (parent) {
    while (parent.parent) {
      parent = parent.parent;
    }
    config = parent.config;
  }

  if (!config) return {};

  const { addGlobalAttributes, addAttributes } = config;
  const attrs = {};

  if (addGlobalAttributes) {
    getAttribute(element, attrs, addGlobalAttributes.call(ext));
  }

  if (addAttributes) {
    getAttribute(element, attrs, addAttributes.call(ext));
  }

  return attrs;
};
