/**
 * Core Extension Module
 * This is the main extension class that Scratch will register
 * Load this first (01-* naming convention)
 */

// Import colorBlock from 02-example-module.js
import { colorBlock } from './02-example-module.js';

class TurboWarpExtension {
  constructor() {
    this.runtime = null;
  }

  /**
   * Return extension info for Scratch
   * This method is required by the Scratch extension protocol
   */
  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('My Extension'),
      color1: '#4CAF50',
      color2: '#45a049',
      color3: '#3d8b40',
      menuIconURI: '',
      blockIconURI: '',
      blocks: [
        {
          opcode: 'helloWorld',
          blockType: 'reporter',
          text: Scratch.translate('hello world'),
        },
        {
          opcode: 'add',
          blockType: 'reporter',
          text: Scratch.translate('[A] + [B]'),
          arguments: {
            A: {
              type: 'number',
              defaultValue: 0,
            },
            B: {
              type: 'number',
              defaultValue: 1,
            },
          },
        },
        {
          opcode: 'colorBlock',
          blockType: 'reporter',
          text: Scratch.translate('selected color [COLOR]'),
          arguments: {
            COLOR: {
              type: 'color',
              defaultValue: '#FF0000',
            },
          },
        },
      ],
    };
  }

  /**
   * Block implementation: Hello World
   */
  helloWorld() {
    return 'hello world!';
  }

  /**
   * Block implementation: Add
   */

  add(args) {
    return Number(args.A) + Number(args.B);
  }

  /**
   * Block implementation: Color Block (delegates to 02-example-module.js)
   */
  colorBlock(args) {
    return colorBlock(args);
  }
}

// Register the extension
Scratch.extensions.register(new TurboWarpExtension());
