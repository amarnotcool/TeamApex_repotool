'use strict';

/**
 * A minimal XML well-formedness checker, for asserting that our SVG output
 * really is a document a parser would accept.
 *
 * Node has no XML parser in its standard library and we take no dependencies,
 * so we write the smallest one that can actually fail: it walks the document,
 * checks that every tag is closed by its own name in the right order, that
 * attributes are quoted, and that no raw `<` or unescaped `&` leaks into text.
 * That is precisely the class of bug a hand-built serialiser produces.
 */

class XmlError extends Error {}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ENTITY = /&(?:#\d+|#x[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/y;

/**
 * Parse an XML document into a tree of { name, attributes, children }.
 * Throws XmlError on anything malformed.
 */
function parseXml(source) {
  let index = 0;
  const stack = [];
  let root = null;

  const fail = (message) => {
    throw new XmlError(`${message} at offset ${index}`);
  };

  const readName = () => {
    NAME.lastIndex = index;
    const match = NAME.exec(source);
    if (!match) fail('expected a name');
    index = NAME.lastIndex;
    return match[0];
  };

  const skipSpace = () => {
    while (index < source.length && /\s/.test(source[index])) index++;
  };

  const readText = (text) => {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '>') continue;
      if (text[i] !== '&') continue;
      ENTITY.lastIndex = i;
      if (!ENTITY.exec(source.slice(0, 0) + text)) fail('unescaped & in text');
    }
  };

  while (index < source.length) {
    const next = source.indexOf('<', index);
    if (next === -1) {
      readText(source.slice(index));
      break;
    }
    readText(source.slice(index, next));
    index = next + 1;

    // Prolog, comments and processing instructions: skip to the closing '>'.
    if (source[index] === '?' || source[index] === '!') {
      const end = source.indexOf('>', index);
      if (end === -1) fail('unterminated declaration');
      index = end + 1;
      continue;
    }

    if (source[index] === '/') {
      index++;
      const name = readName();
      skipSpace();
      if (source[index] !== '>') fail('malformed closing tag');
      index++;
      const open = stack.pop();
      if (!open) fail(`closing tag </${name}> with nothing open`);
      if (open.name !== name) fail(`</${name}> closes <${open.name}>`);
      continue;
    }

    const name = readName();
    const element = { name, attributes: {}, children: [] };

    for (;;) {
      skipSpace();
      if (source[index] === '/' && source[index + 1] === '>') {
        index += 2;
        break;
      }
      if (source[index] === '>') {
        index++;
        stack.push(element);
        break;
      }
      const attribute = readName();
      skipSpace();
      if (source[index] !== '=') fail(`attribute ${attribute} has no value`);
      index++;
      skipSpace();
      const quote = source[index];
      if (quote !== '"' && quote !== "'") fail(`attribute ${attribute} is not quoted`);
      const end = source.indexOf(quote, index + 1);
      if (end === -1) fail(`attribute ${attribute} is not terminated`);
      const value = source.slice(index + 1, end);
      if (value.includes('<')) fail(`attribute ${attribute} contains a raw <`);
      element.attributes[attribute] = value;
      index = end + 1;
    }

    const parent = stack[stack.length - 1] === element ? stack[stack.length - 2] : stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) fail('a second root element');
    else root = element;
  }

  if (stack.length) throw new XmlError(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError('no root element');
  return root;
}

/** Every element in the tree whose class attribute contains `className`. */
function findByClass(node, className, found = []) {
  const classes = String(node.attributes.class || '').split(/\s+/);
  if (classes.includes(className)) found.push(node);
  for (const child of node.children) findByClass(child, className, found);
  return found;
}

module.exports = { parseXml, findByClass, XmlError };
