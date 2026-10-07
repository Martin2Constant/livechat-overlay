// Twitter rejects media requests carrying the loopback Referer used by the
// overlay. Omit it only for Twitter videos; YouTube still needs its Referer.
function configureMediaRequests(session) {
    session.webRequest.onBeforeSendHeaders({ urls: ['https://video.twimg.com/*'] }, (details, callback) => {
        const headers = { ...details.requestHeaders };
        if (details.resourceType === 'media') {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'referer') delete headers[key];
            }
        }
        callback({ requestHeaders: headers });
    });
}
module.exports = { configureMediaRequests };
