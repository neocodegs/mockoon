import { Injectable } from '@angular/core';
import { OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { RemoveLeadingSlash } from 'src/app/libs/utils.lib';
import { Environment } from 'src/app/types/environment.type';
import { methods, Route, RouteResponse, statusCodes } from 'src/app/types/route.type';
import * as SwaggerParser from 'swagger-parser';
import * as uuid from 'uuid/v1';


/**
 * WIP
 *
 * TODO:
 * - get response specific headers DONE
 * - get multiple responses DONE
 * - better handling of variable (find in parameter object and really replace) DONE
 * - add route response description in futur label DONE
 * - create mock objects from entities definition WIP
 * - test/adapt for v3
 *
 * - use https://www.npmjs.com/package/json-schema-faker to generate objects from schemaS?
 * - for export use something like for body objects https://www.npmjs.com/package/to-json-schema
 *
 * insomnia example: https://github.com/getinsomnia/insomnia/blob/8a751883f893437c5228eb266f3ec3a58e4a53c8/packages/insomnia-importers/src/importers/swagger2.js#L1-L18
 *
 */

type parametersTypes = 'PATH_PARAMETERS' | 'SERVER_VARIABLES';

@Injectable()
export class OpenAPIConverterService {

  constructor() { }

  public async import(filePath: string, availablePort?: number) {
    const parsedAPI: OpenAPIV2.Document | OpenAPIV3.Document = await SwaggerParser.dereference(filePath);

    if (parsedAPI['swagger'] && parsedAPI['swagger'] === '2.0') {
      return this.convertV2Format(parsedAPI as OpenAPIV2.Document, availablePort);
    } else if (parsedAPI['openapi'] && parsedAPI['openapi'] === '3.0.0') {
      return this.convertV3Format(parsedAPI as OpenAPIV3.Document);
    } else {
      // TODO add error toast
      return;
    }
  }

  /**
   * Convert Swagger 2.0 format
   * https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md
   *
   * @param parsedAPI
   */
  private convertV2Format(parsedAPI: OpenAPIV2.Document, availablePort: number): Environment {
    const parsedPort = parsedAPI.host.split(':')[1];

    const newenv: Environment = {
      uuid: uuid(),
      name: parsedAPI.info.title || '',
      endpointPrefix: RemoveLeadingSlash(parsedAPI.basePath),
      latency: 0,
      port: parsedPort && parseInt(parsedPort, 10) || availablePort,
      routes: [],
      proxyMode: false,
      proxyHost: '',
      https: false,
      cors: true,
      headers: []
    };

    Object.keys(parsedAPI.paths).forEach((routePath) => {
      Object.keys(parsedAPI.paths[routePath]).forEach((routeMethod) => {
        const parsedRoute: OpenAPIV2.OperationObject = parsedAPI.paths[routePath][routeMethod];
        if (methods.includes(routeMethod)) {
          const routeContentTypeHeader = { key: 'Content-Type', value: 'application/json' };

          if (parsedRoute.produces && !parsedRoute.produces.includes('application/json')) {
            routeContentTypeHeader.value = parsedRoute.produces[0];
          }

          const routeResponses: RouteResponse[] = [];
          Object.keys(parsedRoute.responses).forEach(responseStatus => {
            // filter unsupported status codes (i.e. ranges containing "X", 4XX, 5XX, etc)
            if (statusCodes.find(statusCode => statusCode.code.toString() === responseStatus) || responseStatus === 'default') {
              let responseHeaders = [routeContentTypeHeader];
              const routeResponse: OpenAPIV2.ResponseObject = parsedRoute.responses[responseStatus];

              if (routeResponse.headers) {
                responseHeaders = [routeContentTypeHeader, ...Object.keys(routeResponse.headers).map(header => ({ key: header, value: '' }))];
              }

              let body = '{}';
              if (routeResponse.schema) {
                body = JSON.stringify(this.generateSchema(routeResponse.schema), undefined, 2);
              }

              routeResponses.push({
                uuid: uuid(),
                rules: [],
                body,
                latency: 0,
                statusCode: (responseStatus === 'default') ? '200' : responseStatus.toString(),
                label: routeResponse.description || '',
                headers: responseHeaders,
                filePath: null,
                sendFileAsBody: false
              });
            }
          });

          // check if has at least one 200
          if (!routeResponses.find(response => response.statusCode === '200')) {
            routeResponses.unshift({
              uuid: uuid(),
              rules: [],
              body: '{}',
              latency: 0,
              statusCode: '200',
              label: '',
              headers: [{ key: 'Content-Type', value: 'application/json' }],
              filePath: null,
              sendFileAsBody: false
            });
          }

          const newRoute: Route = {
            uuid: uuid(),
            enabled: true,
            documentation: parsedRoute.summary || parsedRoute.description || '',
            method: routeMethod as any,
            endpoint: RemoveLeadingSlash(this.parametersReplace(routePath, 'PATH_PARAMETERS')),
            responses: routeResponses
          };

          newenv.routes.push(newRoute);
        }
      });
    });

    return newenv;
  }

  /**
   * Convert OpenAPI 3.0 format
   * https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md
   *
   * @param parsedDefinition
   */
  private convertV3Format(parsedDefinition: OpenAPIV3.Document) {

    const newenv: Environment = {
      uuid: uuid(),
      name: parsedDefinition.info.title || '',
      endpointPrefix: '',
      latency: 0,
      port: 3000,
      routes: [],
      proxyMode: false,
      proxyHost: '',
      https: false,
      cors: true,
      headers: []
    };
    /*
        // TODO handle variables in server ?
        const server = parsedDefinition.servers;
        newenv.endpointPrefix = server && server[0] && server[0].url && RemoveLeadingSlash(url.parse(this.parametersReplace(server[0].url, 'SERVER_VARIABLES', server[0].variables)).path);

        Object.keys(parsedDefinition.paths).forEach((routePath) => {
          Object.keys(parsedDefinition.paths[routePath]).forEach((routeMethod) => {
            const parsedRoute = parsedDefinition.paths[routePath][routeMethod];
            // TODO check if route method exists in mockoon (swagger also has TRACE)
            if (routeMethod) {
              // WIP get headers from "headers" or "produces"
              const headers = (parsedRoute.headers) ? Object.keys(parsedRoute.headers).map((header) => ({ uuid: 'TODO', key: header, value: '' })) : parsedRoute.produces && parsedRoute.produces[0];

              const newRoute: Route = {
                uuid: uuid(),
                documentation: parsedRoute.summary || parsedRoute.description || '',
                method: routeMethod as any,
                endpoint: RemoveLeadingSlash(this.parametersReplace(routePath, 'PATH_PARAMETERS')),
                // TODO use route responses
                responses: [{
                  uuid: uuid(),
                  rules: [],
                  body: '{}',
                  latency: 0,
                  statusCode: '200',
                  headers: [headers || { uuid: '', key: 'Content-Type', value: 'application/json' }],
                  filePath: null,
                  sendFileAsBody: false
                }]

              };

              newenv.routes.push(newRoute);
            }
          });
        }); */

    return newenv;
  }

  private parametersReplace<T extends parametersTypes>(
    str: string,
    parametersType: T,
    parameters?: T extends 'PATH_PARAMETERS' ? never : OpenAPIV3.ServerVariableObject) {
    return str.replace(/{(\w+)}/ig, (searchValue, replaceValue) => {
      if (parametersType === 'PATH_PARAMETERS') {
        return ':' + replaceValue;
      } else if (parametersType === 'SERVER_VARIABLES') {
        return parameters[replaceValue].default;
      }
    });
  }


  /**
   * Generate a JS object from a schema
   *
   */
  private generateSchema(schema) {
    const typeFactories = {
      string: () => 'string',
      string_email: () => 'test@example.com',
      string_byte: () => 'U3dhZ2dlciByb2Nrcw==',
      'string_date-time': () => new Date().toISOString(),
      number: () => 0,
      number_double: () => 0.0,
      number_float: () => 0.0,
      boolean: () => true,
      integer: () => 0,
      array: arraySchema => {
        const newObject = this.generateSchema(arraySchema.items);
        if (arraySchema.collectionFormat === 'csv') {
          return newObject;
        } else {
          return [newObject];
        }
      },
      object: objectSchema => {
        const newObject = {};
        const { properties } = objectSchema;

        if (properties) {
          Object.keys(properties).forEach(propertyName => {
            newObject[propertyName] = this.generateSchema(
              properties[propertyName]
            );
          });
        }

        return newObject;
      }
    };

    if (typeof schema === 'string') {
      return typeFactories[schema];
    }

    if (schema instanceof Object) {
      const { type, format, example, default: defaultValue } = schema;

      if (example) {
        return example;
      }

      if (defaultValue) {
        return defaultValue;
      }

      const typeFactory = typeFactories[`${type}_${format}`] || typeFactories[type];

      return typeFactory(schema);
    }
  }
}
