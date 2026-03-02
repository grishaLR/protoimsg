/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { XrpcClient, FetchHandler, FetchHandlerOptions } from '@atproto/xrpc';
import { schemas } from './lexicons';
import { CID } from 'multiformats/cid';
import * as AppProtoimsgChatAllowlist from './types/app/protoimsg/chat/allowlist';
import * as AppProtoimsgChatAuthVerify from './types/app/protoimsg/chat/authVerify';
import * as AppProtoimsgChatBan from './types/app/protoimsg/chat/ban';
import * as AppProtoimsgChatChannel from './types/app/protoimsg/chat/channel';
import * as AppProtoimsgChatCommunity from './types/app/protoimsg/chat/community';
import * as AppProtoimsgChatMessage from './types/app/protoimsg/chat/message';
import * as AppProtoimsgChatPoll from './types/app/protoimsg/chat/poll';
import * as AppProtoimsgChatRole from './types/app/protoimsg/chat/role';
import * as AppProtoimsgChatRoom from './types/app/protoimsg/chat/room';
import * as AppProtoimsgChatVote from './types/app/protoimsg/chat/vote';

export * as AppProtoimsgChatAllowlist from './types/app/protoimsg/chat/allowlist';
export * as AppProtoimsgChatAuthVerify from './types/app/protoimsg/chat/authVerify';
export * as AppProtoimsgChatBan from './types/app/protoimsg/chat/ban';
export * as AppProtoimsgChatChannel from './types/app/protoimsg/chat/channel';
export * as AppProtoimsgChatCommunity from './types/app/protoimsg/chat/community';
export * as AppProtoimsgChatMessage from './types/app/protoimsg/chat/message';
export * as AppProtoimsgChatPoll from './types/app/protoimsg/chat/poll';
export * as AppProtoimsgChatRole from './types/app/protoimsg/chat/role';
export * as AppProtoimsgChatRoom from './types/app/protoimsg/chat/room';
export * as AppProtoimsgChatVote from './types/app/protoimsg/chat/vote';

export class AtpBaseClient extends XrpcClient {
  app: AppNS;

  constructor(options: FetchHandler | FetchHandlerOptions) {
    super(options, schemas);
    this.app = new AppNS(this);
  }

  /** @deprecated use `this` instead */
  get xrpc(): XrpcClient {
    return this;
  }
}

export class AppNS {
  _client: XrpcClient;
  protoimsg: AppProtoimsgNS;

  constructor(client: XrpcClient) {
    this._client = client;
    this.protoimsg = new AppProtoimsgNS(client);
  }
}

export class AppProtoimsgNS {
  _client: XrpcClient;
  chat: AppProtoimsgChatNS;

  constructor(client: XrpcClient) {
    this._client = client;
    this.chat = new AppProtoimsgChatNS(client);
  }
}

export class AppProtoimsgChatNS {
  _client: XrpcClient;
  allowlist: AllowlistRecord;
  authVerify: AuthVerifyRecord;
  ban: BanRecord;
  channel: ChannelRecord;
  community: CommunityRecord;
  message: MessageRecord;
  poll: PollRecord;
  role: RoleRecord;
  room: RoomRecord;
  vote: VoteRecord;

  constructor(client: XrpcClient) {
    this._client = client;
    this.allowlist = new AllowlistRecord(client);
    this.authVerify = new AuthVerifyRecord(client);
    this.ban = new BanRecord(client);
    this.channel = new ChannelRecord(client);
    this.community = new CommunityRecord(client);
    this.message = new MessageRecord(client);
    this.poll = new PollRecord(client);
    this.role = new RoleRecord(client);
    this.room = new RoomRecord(client);
    this.vote = new VoteRecord(client);
  }
}

export class AllowlistRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatAllowlist.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.allowlist',
      ...params,
    });
    return res.data;
  }

  async get(params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>): Promise<{
    uri: string;
    cid: string;
    value: AppProtoimsgChatAllowlist.Record;
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.allowlist',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatAllowlist.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.allowlist';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.allowlist', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.allowlist', ...params },
      { headers },
    );
  }
}

export class AuthVerifyRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatAuthVerify.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.authVerify',
      ...params,
    });
    return res.data;
  }

  async get(params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>): Promise<{
    uri: string;
    cid: string;
    value: AppProtoimsgChatAuthVerify.Record;
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.authVerify',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatAuthVerify.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.authVerify';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.authVerify', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.authVerify', ...params },
      { headers },
    );
  }
}

export class BanRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatBan.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.ban',
      ...params,
    });
    return res.data;
  }

  async get(
    params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppProtoimsgChatBan.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.ban',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatBan.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.ban';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.ban', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.ban', ...params },
      { headers },
    );
  }
}

export class ChannelRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatChannel.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.channel',
      ...params,
    });
    return res.data;
  }

  async get(params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>): Promise<{
    uri: string;
    cid: string;
    value: AppProtoimsgChatChannel.Record;
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.channel',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatChannel.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.channel';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.channel', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.channel', ...params },
      { headers },
    );
  }
}

export class CommunityRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatCommunity.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.community',
      ...params,
    });
    return res.data;
  }

  async get(params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>): Promise<{
    uri: string;
    cid: string;
    value: AppProtoimsgChatCommunity.Record;
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.community',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatCommunity.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.community';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      {
        collection: 'app.protoimsg.chat.community',
        rkey: 'self',
        ...params,
        record,
      },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.community', ...params },
      { headers },
    );
  }
}

export class MessageRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatMessage.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.message',
      ...params,
    });
    return res.data;
  }

  async get(params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>): Promise<{
    uri: string;
    cid: string;
    value: AppProtoimsgChatMessage.Record;
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.message',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatMessage.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.message';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.message', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.message', ...params },
      { headers },
    );
  }
}

export class PollRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatPoll.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.poll',
      ...params,
    });
    return res.data;
  }

  async get(
    params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppProtoimsgChatPoll.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.poll',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatPoll.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.poll';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.poll', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.poll', ...params },
      { headers },
    );
  }
}

export class RoleRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatRole.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.role',
      ...params,
    });
    return res.data;
  }

  async get(
    params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppProtoimsgChatRole.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.role',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatRole.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.role';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.role', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.role', ...params },
      { headers },
    );
  }
}

export class RoomRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatRoom.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.room',
      ...params,
    });
    return res.data;
  }

  async get(
    params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppProtoimsgChatRoom.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.room',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatRoom.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.room';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.room', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.room', ...params },
      { headers },
    );
  }
}

export class VoteRecord {
  _client: XrpcClient;

  constructor(client: XrpcClient) {
    this._client = client;
  }

  async list(params: Omit<ComAtprotoRepoListRecords.QueryParams, 'collection'>): Promise<{
    cursor?: string;
    records: { uri: string; value: AppProtoimsgChatVote.Record }[];
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.protoimsg.chat.vote',
      ...params,
    });
    return res.data;
  }

  async get(
    params: Omit<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppProtoimsgChatVote.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.protoimsg.chat.vote',
      ...params,
    });
    return res.data;
  }

  async create(
    params: Omit<ComAtprotoRepoCreateRecord.InputSchema, 'collection' | 'record'>,
    record: AppProtoimsgChatVote.Record,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    record.$type = 'app.protoimsg.chat.vote';
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection: 'app.protoimsg.chat.vote', ...params, record },
      { encoding: 'application/json', headers },
    );
    return res.data;
  }

  async delete(
    params: Omit<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.protoimsg.chat.vote', ...params },
      { headers },
    );
  }
}
