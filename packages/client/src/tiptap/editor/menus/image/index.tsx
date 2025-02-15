import React from 'react';
import { Editor } from 'tiptap/editor';

import { ImageBubbleMenu } from './bubble';

export const Image: React.FC<{ editor: Editor }> = ({ editor }) => {
  return (
    <>
      <ImageBubbleMenu editor={editor} />
    </>
  );
};
