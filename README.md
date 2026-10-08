# Acorns

A Wikipedia SPI tool.

## OAuth for local development

To allow for local development, please follow these steps:
1) Go to [the OAuth consumer registration page](https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2?wpname=Acorns&wpdescription=SPI+Tool&wpcallbackUrl=http://localhost:3000/callback&wpoauth2IsConfidential=0&wpagreement=1)
2) Scroll down to where it says "Applicable grants" and check "High-volume (bot) access"
3) Scroll to the bottom of the page and click "Propose consumer"
4) Copy the `Client ID` on the confirmation page and store it for later.


## Server

### Clone the repository
```bash
git clone https://github.com/LuniZunie/Acorns.git
cd Acorns
```

### Install dependencies
```bash
npm install
```

### Setup

```bash
echo -e "TEAPOT=0\nPORT=3000\nCLIENT=your_client_id" > .env
```

Replace `your_client_id` with the `Client ID` you obtained from the OAuth consumer.

### Start the server
```bash
npm start
```

You should see the following in the console:
```
HTTP server running on http://0.0.0.0:3000
WebSocket server running on ws://0.0.0.0:3000
```

## Client

### Client connection

Go to `http://localhost:3000` in your web browser, you should now see a webpage.

### Using the retrieved user data

User data retrieval runs in a web worker so API requests and revision parsing do not block the client interface.

Parsed users with return the following data structure (note the information is mock data):

```jsonc
{
    "user": "Example",
    "registration": { /* Global registration info */
        "project": "metawiki",
        "timestamp": "1970-01-01T00:00:00Z"
    },
    "locked": true, /* Globally locked? */
    "block": [ /* Current global blocks */
        {
            "id": "0",
            "anononly": false,
            "account-creation-disabled": true,
            "block-email": false,
            "autoblocking-enabled": true,
            "automatic": false,
            "by": "WMF-Office",
            "bywiki": "metawiki",
            "timestamp": "1970-01-01T00:00:00Z",
            "expiry": "infinity",
            "reason": "Testing"
        }
    ],
    "blocks": [ /* Global block log events */
        {
            "logid": 1,
            "title": "User:Example",
            "timestamp": "1970-01-01T00:00:00Z",
            "comment": "Testing",
            "params": { },
            "user": "WMF-Office",
            "unblock": false
        }
    ],
    "locks": [ /* Global lock-status log events */
        {
            "logid": 2,
            "title": "User:Example@global",
            "timestamp": "1970-01-01T00:00:00Z",
            "comment": "Testing",
            "params": { },
            "user": "WMF-Office"
        }
    ],
    "edit_count": 42, /* Global edit count */
    "groups": [ /* Global groups info */
        "global-rollbacker"
    ],
    "rights": [ /* Global rights info */
        "rollback",
        "skipcaptcha"
    ],
    "uploads": [
        {
            "logid": 0,
            "title": "File:Example.png",
            "timestamp": "1970-01-01T00:00:00Z",
            "comment": "Uploaded an example file with UploadWizard",
            "tags": [
                "uploadwizard",
            ]
        }
    ],
    "projects": [ /* All projects they are registered on */
        {
            "project": "meta.wikipedia.org",
            "code": "metawiki",
            "registration": {
                "method": "login",
                "timestamp": "1970-01-01T00:00:00Z"
            },
            "block": [ /* Current local blocks */
                {
                    "id": "0",
                    "by": "Administrator",
                    "expiry": "infinity",
                    "duration-l10n": "infinite",
                    "reason": "Testing",
                    "automatic": false,
                    "anononly": false,
                    "nocreate": false,
                    "autoblock": false,
                    "noemail": false,
                    "hidden": false,
                    "block-hidden": false,
                    "allowusertalk": false,
                    "partial": false
                }
            ],
            "blocks": [ /* Local block log events; fetched for projects with edits */
                {
                    "logid": 3,
                    "title": "User:Example",
                    "params": { },
                    "unblock": false,
                    "user": "Administrator",
                    "comment": "Testing",
                    "timestamp": "1970-01-01T00:00:00Z"
                }
            ],
            "edit_count": 1,
            "edits": [
                {
                    "title": "Main Page",
                    "revid": 1,
                    "parentid": 0,
                    "timestamp": "1970-01-01T00:00:00Z",
                    "comment": "Welcome to Wikipedia!",
                    "tags": [
                        "mobile edit",
                    ],
                    "sizediff": 21,
                    "categories": [ "Wikimedia" ], /* Categories on the page at the time */
                    "images": { /* Images CAN have false positives */
                        "+": [ "Welcome.png" ], /* Added images */
                        "-": [ "OldWelcome.png" ] /* Removed images */
                    },
                    "links": {
                        "+": [ "https://meta.wikipedia.org/" ], /* Added links */
                        "-": [ "https://www.google.com/" ] /* Removed links */
                    }
                }
            ]
        }
    ]
}
```