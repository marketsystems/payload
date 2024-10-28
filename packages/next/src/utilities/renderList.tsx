import type { I18nClient } from '@payloadcms/translations'
import type { ListPreferences } from '@payloadcms/ui'
import type {
  ClientConfig,
  Data,
  DocumentPreferences,
  PayloadRequest,
  SanitizedConfig,
  VisibleEntities,
} from 'payload'

import { headers as getHeaders } from 'next/headers.js'
import { createClientConfig, getAccessResults, isEntityHidden, parseCookies } from 'payload'

import { renderListView } from '../views/List/index.js'

let cachedClientConfig = global._payload_clientConfig

if (!cachedClientConfig) {
  cachedClientConfig = global._payload_clientConfig = null
}

export const getClientConfig = (args: {
  config: SanitizedConfig
  i18n: I18nClient
}): ClientConfig => {
  const { config, i18n } = args

  if (cachedClientConfig && process.env.NODE_ENV !== 'development') {
    return cachedClientConfig
  }

  cachedClientConfig = createClientConfig({
    config,
    i18n,
  })

  return cachedClientConfig
}

type RenderListResult = {
  List: React.ReactNode
  preferences: ListPreferences
}

export const renderListFn = async (args: {
  collectionSlug: string
  disableActions?: boolean
  drawerSlug?: string
  enableRowSelections: boolean
  redirectAfterDelete: boolean
  redirectAfterDuplicate: boolean
  req: PayloadRequest
}): Promise<RenderListResult> => {
  const {
    collectionSlug,
    disableActions,
    drawerSlug,
    enableRowSelections,
    redirectAfterDelete,
    redirectAfterDuplicate,
    req,
    req: {
      i18n,
      payload,
      payload: { config },
      user,
    },
  } = args

  const headers = await getHeaders()

  const cookies = parseCookies(headers)

  const incomingUserSlug = user?.collection

  const adminUserSlug = config.admin.user

  // If we have a user slug, test it against the functions
  if (incomingUserSlug) {
    const adminAccessFunction = payload.collections[incomingUserSlug].config.access?.admin

    // Run the admin access function from the config if it exists
    if (adminAccessFunction) {
      const canAccessAdmin = await adminAccessFunction({ req })

      if (!canAccessAdmin) {
        throw new Error('Unauthorized')
      }
      // Match the user collection to the global admin config
    } else if (adminUserSlug !== incomingUserSlug) {
      throw new Error('Unauthorized')
    }
  } else {
    const hasUsers = await payload.find({
      collection: adminUserSlug,
      depth: 0,
      limit: 1,
      pagination: false,
    })

    // If there are users, we should not allow access because of /create-first-user
    if (hasUsers.docs.length) {
      throw new Error('Unauthorized')
    }
  }

  const clientConfig = getClientConfig({
    config,
    i18n,
  })

  const preferencesKey = `${collectionSlug}-list`

  const preferences = await payload
    .find({
      collection: 'payload-preferences',
      depth: 0,
      limit: 1,
      where: {
        and: [
          {
            key: {
              equals: preferencesKey,
            },
          },
          {
            'user.relationTo': {
              equals: user.collection,
            },
          },
          {
            'user.value': {
              equals: user.id,
            },
          },
        ],
      },
    })
    .then((res) => res.docs[0]?.value as ListPreferences)

  const visibleEntities: VisibleEntities = {
    collections: payload.config.collections
      .map(({ slug, admin: { hidden } }) => (!isEntityHidden({ hidden, user }) ? slug : null))
      .filter(Boolean),
    globals: payload.config.globals
      .map(({ slug, admin: { hidden } }) => (!isEntityHidden({ hidden, user }) ? slug : null))
      .filter(Boolean),
  }

  const permissions = await getAccessResults({
    req,
  })

  const { List } = await renderListView({
    clientConfig,
    disableActions,
    drawerSlug,
    enableRowSelections,
    importMap: payload.importMap,
    initPageResult: {
      collectionConfig: payload.config.collections.find(
        (collection) => collection.slug === collectionSlug,
      ),
      cookies,
      globalConfig: payload.config.globals.find((global) => global.slug === collectionSlug),
      languageOptions: undefined, // TODO
      permissions,
      req,
      translations: undefined, // TODO
      visibleEntities,
    },
    params: {
      segments: ['collections', collectionSlug],
    },
    redirectAfterDelete,
    redirectAfterDuplicate,
    searchParams: {},
  })

  return {
    List,
    preferences,
  }
}
