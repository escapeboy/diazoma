<?php

it('has no env() call outside config/', function () {
    $root = dirname(__DIR__, 2);
    $hits = [];

    foreach (['src', 'routes', 'resources'] as $dir) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$root/$dir", FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (preg_match('/\benv\s*\(|\bgetenv\s*\(|\$_ENV|\$_SERVER\[/', file_get_contents($file->getPathname()))) {
                $hits[] = $file->getPathname();
            }
        }
    }

    expect($hits)->toBe([]);
});
