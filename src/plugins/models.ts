export interface PluginAssembly {
  id: string;
  name: string;
  version?: string;
  isolationMode?: number;
  publicKeyToken?: string;
  culture?: string;
  sourceType?: number;
}

export interface PluginType {
  id: string;
  name: string;
  friendlyName?: string;
  typeName?: string;
}

export interface PluginStep {
  id: string;
  name: string;
  mode?: number;
  stage?: number;
  rank?: number;
  status?: number;
  statusReason?: number;
  messageName?: string;
  primaryEntity?: string;
  filteringAttributes?: string;
}

export interface PluginImage {
  id: string;
  name: string;
  type?: number;
  entityAlias?: string;
  attributes?: string;
  messagePropertyName?: string;
}
