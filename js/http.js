window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;

  // Fetch-shaped responses keep the GitHub and workspace error paths together.
  // HTTP errors are returned; callers decide whether to retry a read or a write.
  App.http = {
    fetch: function (url, options) {
      options = options || {};
      var axios = App.libs && App.libs.axios;
      if (!axios) return fetch(url, options);
      return axios.request({
        url: url,
        method: options.method || 'GET',
        headers: options.headers || {},
        data: options.body,
        signal: options.signal,
        timeout: options.timeout || 15000,
        withCredentials: false,
        responseType: 'text',
        transformResponse: [],
        validateStatus: function () { return true; }
      }).then(function (response) {
        return {
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
          json: function () {
            return Promise.resolve().then(function () {
              return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            });
          },
          text: function () { return Promise.resolve(typeof response.data === 'string' ? response.data : JSON.stringify(response.data)); }
        };
      }).catch(function (error) {
        // Axios errors carry the request config. Expose only a useful message.
        throw new Error(error.code === 'ECONNABORTED' ? 'Request timed out' : error.code === 'ERR_CANCELED' ? 'Request canceled' : 'Network request failed');
      });
    }
  };
})();
