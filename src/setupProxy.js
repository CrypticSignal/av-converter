module.exports = function (app) {
    app.use(function (request, response, next) {
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
    });
};