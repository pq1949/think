import { onAuthenticatePayload, onChangePayload, onLoadDocumentPayload, Server } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DocumentService } from '@services/document.service';
import { DocumentVersionService } from '@services/document-version.service';
import { TemplateService } from '@services/template.service';
import { OutUser, UserService } from '@services/user.service';
import { getConfig } from '@think/config';
import { DocumentStatus } from '@think/domains';
import * as lodash from 'lodash';
import * as Y from 'yjs';

@Injectable()
export class CollaborationService {
  server: typeof Server;
  debounceTime = 1000;
  maxDebounceTime = 10000;
  timers: Map<
    string,
    {
      timeout: NodeJS.Timeout;
      start: number;
    }
  > = new Map();

  constructor(
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    @Inject(forwardRef(() => DocumentService))
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => TemplateService))
    private readonly templateService: TemplateService,
    @Inject(forwardRef(() => DocumentVersionService))
    private readonly documentVersionService: DocumentVersionService
  ) {
    this.initServer();
  }

  debounce(id: string, func: () => void, debounceTime = this.debounceTime, immediately = false) {
    const old = this.timers.get(id);
    const start = old?.start || Date.now();

    const run = () => {
      this.timers.delete(id);
      func();
    };

    if (old?.timeout) {
      clearTimeout(old.timeout);
    }

    if (immediately) {
      return run();
    }

    if (Date.now() - start >= this.maxDebounceTime) {
      return run();
    }

    this.timers.set(id, {
      start,
      timeout: setTimeout(run, debounceTime),
    });
  }

  private async initServer() {
    try {
      const server = Server.configure({
        quiet: true,
        onAuthenticate: this.onAuthenticate.bind(this),
        onLoadDocument: this.onLoadDocument.bind(this),
        onChange: this.onChange.bind(this),
        onDisconnect: this.onDisconnect.bind(this),
      });
      this.server = server;
      await this.server.listen(lodash.get(getConfig(), 'server.collaborationPort', 5003));
      console.log('[think] 协作服务启动成功');
    } catch (err) {
      console.error('[think] 协作服务启动失败：', err.message);
    }
  }

  async onAuthenticate({ connection, token, requestParameters }: onAuthenticatePayload) {
    const targetId = requestParameters.get('targetId');
    const docType = requestParameters.get('docType');
    const user = token ? await this.userService.decodeToken(token) : null;

    switch (docType) {
      case 'document': {
        if (!user) {
          const document = await this.documentService.findById(targetId);
          if (!document || document.status !== DocumentStatus.public) {
            throw new HttpException('您无权查看此文档', HttpStatus.FORBIDDEN);
          }
          return { user: { name: '匿名用户' } };
        } else {
          const authority = await this.documentService.getDocumentAuthority(targetId, user.id);
          if (!authority.readable) {
            throw new HttpException('您无权查看此文档', HttpStatus.FORBIDDEN);
          }
          if (!authority.editable) {
            connection.readOnly = true;
          }
          return {
            user,
          };
        }
      }

      case 'template': {
        if (!user || !user.id) {
          throw new HttpException('您无权查看', HttpStatus.UNAUTHORIZED);
        }

        const template = await this.templateService.findById(targetId);
        if (template.createUserId !== user.id) {
          throw new HttpException('您无权查看此模板', HttpStatus.FORBIDDEN);
        }
        return {
          user,
        };
      }

      default:
        throw new Error('未知类型');
    }
  }

  /**
   * 创建文档
   * @param data
   * @returns
   */
  async onLoadDocument(data: onLoadDocumentPayload) {
    const { requestParameters, document } = data;
    const targetId = requestParameters.get('targetId');
    const docType = requestParameters.get('docType');

    let state = null;

    switch (docType) {
      case 'document': {
        const res = await this.documentService.findById(targetId);
        state = res.state;
        break;
      }

      case 'template': {
        const res = await this.templateService.findById(targetId);
        state = res.state;
        break;
      }

      default:
        throw new Error('未知类型');
    }

    const unit8 = new Uint8Array(state);

    if (unit8.byteLength) {
      Y.applyUpdate(document, unit8);
    }

    return document;
  }

  async onChange(data: onChangePayload) {
    const { requestParameters } = data;

    const targetId = requestParameters.get('targetId');
    const docType = requestParameters.get('docType');

    const updateDocument = async (user: OutUser, documentId: string, data) => {
      await this.documentService.updateDocument(user, documentId, data);
      this.debounce(
        `onStoreDocumentVersion-${documentId}`,
        () => {
          this.documentVersionService.storeDocumentVersion(documentId, data.content);
        },
        this.debounceTime * 2
      );
    };
    const updateTemplate = this.templateService.updateTemplate.bind(this.templateService);

    const updateHandler = docType === 'document' ? updateDocument : updateTemplate;

    this.debounce(`onStoreDocument-${targetId}`, () => {
      this.onStoreDocument(updateHandler, data).catch((error) => {
        if (error?.message) {
          throw new HttpException(error?.message, HttpStatus.SERVICE_UNAVAILABLE);
        }
      });
    });
  }

  async onStoreDocument(updateHandler, data: onChangePayload) {
    const { requestParameters } = data;
    const targetId = requestParameters.get('targetId');
    const userId = requestParameters.get('userId');

    if (!userId) {
      throw new HttpException('无用户信息，拒绝存储文档数据变更', HttpStatus.FORBIDDEN);
    }

    const node = TiptapTransformer.fromYdoc(data.document);
    const title = lodash.get(node, `default.content[0].content[0].text`, '').replace(/\s/g, '').slice(0, 255);
    const state = Buffer.from(Y.encodeStateAsUpdate(data.document));
    await updateHandler({ id: userId } as OutUser, targetId, {
      title,
      content: JSON.stringify(node),
      state,
    });
  }

  async onDisconnect(data) {
    const { requestParameters } = data;
    const targetId = requestParameters.get('targetId');
    const docType = requestParameters.get('docType');
    const userId = requestParameters.get('userId');

    if (docType === 'document') {
      const data = await this.documentService.findById(targetId);
      if (data && !data.title) {
        await this.documentService.updateDocument({ id: userId } as OutUser, targetId, {
          title: '未命名文档',
        });
      }
      return;
    }

    if (docType === 'template') {
      const data = await this.templateService.findById(targetId);
      if (data && !data.title) {
        await this.templateService.updateTemplate({ id: userId } as OutUser, targetId, {
          title: '未命名模板',
        });
      }
      return;
    }
  }
}
