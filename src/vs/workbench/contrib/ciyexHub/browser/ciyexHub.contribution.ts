/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ciyex Hub marketplace integration
// This module bridges the Ciyex marketplace API to VS Code's extension gallery,
// allowing the Extensions sidebar to browse, search, and manage Ciyex healthcare apps.
//
// The marketplace calls are proxied through the Ciyex API:
//   {ciyexApiUrl}/api/marketplace/apps -> marketplace backend
//
// This avoids direct calls to the marketplace backend and reuses the auth token.
